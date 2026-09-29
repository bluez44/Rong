# Deploy backend lên AWS EC2

Một máy EC2 `t3.micro` chạy Docker Compose: Caddy (HTTPS) → backend → PostGIS.
Push lên `main` có thay đổi backend (`apps/backend`, `packages/shared-types`,
`infra/prod`, `pnpm-lock.yaml`) thì GitHub Actions test, build image lên Docker Hub,
rồi ra lệnh cho máy kéo image mới qua SSM Run Command (không mở cổng SSH).

```
GitHub Actions ─ build & push ─▶ Docker Hub (repo private)
      └─ SSM Run Command ─▶ EC2 /opt/rong/deploy.sh <image>
                              ├─ .env ← SSM Parameter Store (/rong/prod/app/*)
                              ├─ docker compose pull && up -d  (backend tự chạy migration khi khởi động)
                              └─ chờ /api/health = ok, hỏng thì quay về image trước
```

| File | Vai trò |
|---|---|
| `apps/backend/Dockerfile` | Image backend (build từ gốc repo) |
| `apps/backend/docker-entrypoint.sh` | Chạy migration rồi mới start |
| `infra/prod/docker-compose.yml`, `Caddyfile` | Các service trên máy |
| `infra/prod/deploy.sh` | Chạy trên máy mỗi lần deploy |
| `infra/prod/bootstrap.sh` | Chuẩn bị máy mới (user-data) |
| `.github/workflows/deploy-backend.yml` | Pipeline |

Database **không có backup**: mất máy hoặc ổ đĩa là mất dữ liệu.

## Cài đặt một lần

Cần AWS CLI v2 đăng nhập bằng tài khoản có quyền admin. Các lệnh dưới đây
chạy bằng bash (Git Bash, WSL, macOS, Linux).

### 0. Docker Hub

1. Tạo repo **private**, ví dụ `bluez44/rong-backend`.
2. Account settings → Personal access tokens, tạo hai token:
   - `github-actions`: quyền **Read & Write** (GitHub Actions đẩy image).
   - `ec2-pull`: quyền **Read-only** (máy EC2 kéo image).

### 1. Biến dùng chung

```bash
export AWS_REGION=ap-southeast-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
GITHUB_REPO=bluez44/Rong
```

### 2. IAM role cho máy EC2

Máy cần: nhận lệnh SSM, đọc parameter `/rong/prod/*`.

```bash
aws iam create-role --role-name rong-ec2 --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }, "Action": "sts:AssumeRole" }]
}'
aws iam attach-role-policy --role-name rong-ec2 \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam put-role-policy --role-name rong-ec2 --policy-name read-rong-params --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"ssm:GetParameter\", \"ssm:GetParametersByPath\"],
    \"Resource\": [
      \"arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter/rong/prod\",
      \"arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter/rong/prod/*\"
    ]
  }]
}"
aws iam create-instance-profile --instance-profile-name rong-ec2
aws iam add-role-to-instance-profile --instance-profile-name rong-ec2 --role-name rong-ec2
```

### 3. Security group: chỉ mở 80 và 443

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 create-security-group --group-name rong-web --description "Rong backend HTTP/HTTPS" \
  --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 443 --cidr 0.0.0.0/0
```

### 4. Tạo máy EC2

Amazon Linux 2023, `t3.micro`, ổ 20 GB gp3, chạy `bootstrap.sh` ở lần khởi động đầu.
Chạy từ gốc repo (cần đường dẫn tới `bootstrap.sh`):

```bash
AMI_ID=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" --instance-type t3.micro \
  --iam-instance-profile Name=rong-ec2 \
  --security-group-ids "$SG_ID" \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3}' \
  --metadata-options HttpTokens=required \
  --user-data file://infra/prod/bootstrap.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=rong-backend}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
echo "$INSTANCE_ID"
```

> Dùng Ubuntu (đã thử với 26.04) cũng được: Ubuntu có sẵn SSM Agent, còn Docker,
> Compose và AWS CLI được `bootstrap.sh` cài từ gói của Ubuntu. Không dán
> `bootstrap.sh` vào user-data cũng không sao — lần deploy đầu tiên tự chạy nó
> khi thấy máy còn thiếu Docker hay AWS CLI (lâu hơn vài phút).
>
> Nếu vừa tạo role ở bước 2 mà `run-instances` báo không tìm thấy instance profile,
> đợi vài chục giây rồi chạy lại (IAM cần thời gian lan truyền).

### 5. Elastic IP và tên miền

IP cố định để tên miền và chứng chỉ HTTPS không đổi khi máy khởi động lại.
Không có tên miền riêng thì dùng tên miễn phí `sslip.io` suy ra từ IP:

```bash
ALLOC_ID=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID"
PUBLIC_IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)
DOMAIN="${PUBLIC_IP//./-}.sslip.io"
echo "$DOMAIN"
```

Có tên miền riêng thì tạo bản ghi A trỏ về `$PUBLIC_IP` và đặt `DOMAIN` bằng tên đó.

### 6. Secret trong SSM Parameter Store

Mỗi parameter dưới `/rong/prod/app/` thành một dòng trong `.env` của backend
(tên parameter = tên biến). Giá trị không được chứa dấu nháy đơn `'`.

```bash
put() { aws ssm put-parameter --name "$1" --type SecureString --value "$2" --overwrite >/dev/null; }

put /rong/prod/app/DOMAIN "$DOMAIN"
put /rong/prod/app/DB_USERNAME rong
put /rong/prod/app/DB_PASSWORD "$(openssl rand -hex 24)"
put /rong/prod/app/DB_DATABASE rong
put /rong/prod/app/JWT_SECRET "$(openssl rand -base64 48 | tr -d "'")"
put /rong/prod/app/GEMINI_API_KEY '<khóa Gemini>'
put /rong/prod/app/TAVILY_API_KEY '<khóa Tavily>'
put /rong/prod/app/GOOGLE_MAPS_API_KEY '<khóa Google Maps>'
put /rong/prod/app/OPEN_DATA_CONTACT_EMAIL '<email liên hệ cho OSM>'
# Không bắt buộc: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM…

put /rong/prod/dockerhub/USERNAME '<tên Docker Hub>'
put /rong/prod/dockerhub/TOKEN '<token ec2-pull (Read-only)>'
```

`DB_HOST`, `DB_PORT`, `NODE_ENV`, `PORT` đã cố định trong `docker-compose.yml`.
Đổi secret xong thì chạy lại workflow (Actions → Deploy backend → Run workflow)
để máy ghi lại `.env`.

### 7. Role cho GitHub Actions (OIDC, không dùng access key)

Claim `sub` trong token của GitHub phải khớp **từng ký tự** với trust policy.
Dạng mặc định là `repo:<owner>/<repo>:environment:production`, nhưng repo này
dùng dạng kèm ID số của owner và repo (chống giả mạo khi đổi tên repo):

```bash
GITHUB_SUB='repo:bluez44@149250732/Rong@1375274123:environment:production'
```

Nếu tạo lại repo hay chuyển sang owner khác thì ID đổi: xem `sub` thật bằng
cách in claim của token trong một job (giải mã phần giữa của token lấy từ
`$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com`), rồi sửa trust policy.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com

aws iam create-role --role-name rong-github-deploy --assume-role-policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": { \"Federated\": \"arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com\" },
    \"Action\": \"sts:AssumeRoleWithWebIdentity\",
    \"Condition\": { \"StringEquals\": {
      \"token.actions.githubusercontent.com:aud\": \"sts.amazonaws.com\",
      \"token.actions.githubusercontent.com:sub\": \"${GITHUB_SUB}\"
    } }
  }]
}"
aws iam put-role-policy --role-name rong-github-deploy --policy-name deploy-via-ssm --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": \"ssm:SendCommand\", \"Resource\": [
        \"arn:aws:ec2:${AWS_REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}\",
        \"arn:aws:ssm:${AWS_REGION}::document/AWS-RunShellScript\" ] },
    { \"Effect\": \"Allow\", \"Action\": \"ssm:GetCommandInvocation\", \"Resource\": \"*\" }
  ]
}"
echo "arn:aws:iam::${ACCOUNT_ID}:role/rong-github-deploy"
```

Role chỉ nhận token từ job có `environment: production` của đúng repo, và chỉ
được gửi lệnh tới đúng máy này.

### 8. Cấu hình GitHub

Settings → Environments: tạo environment **`production`** (có thể bật
"Required reviewers" để duyệt trước mỗi lần deploy).

Settings → Secrets and variables → Actions:

| Loại | Tên | Giá trị |
|---|---|---|
| Secret | `DOCKERHUB_USERNAME` | tên Docker Hub |
| Secret | `DOCKERHUB_TOKEN` | token `github-actions` (Read & Write) |
| Variable | `DOCKERHUB_REPOSITORY` | ví dụ `bluez44/rong-backend` |
| Variable | `AWS_REGION` | `ap-southeast-1` |
| Variable | `AWS_DEPLOY_ROLE_ARN` | ARN in ra ở bước 7 |
| Variable | `EC2_INSTANCE_ID` | `$INSTANCE_ID` |

Hoặc bằng `gh`:

```bash
gh secret set DOCKERHUB_USERNAME --body '<tên Docker Hub>'
gh secret set DOCKERHUB_TOKEN --body '<token github-actions>'
gh variable set DOCKERHUB_REPOSITORY --body '<tên>/rong-backend'
gh variable set AWS_REGION --body "$AWS_REGION"
gh variable set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::${ACCOUNT_ID}:role/rong-github-deploy"
gh variable set EC2_INSTANCE_ID --body "$INSTANCE_ID"
```

### 9. Deploy lần đầu

Push lên `main`, hoặc Actions → **Deploy backend** → Run workflow. Lần đầu
mất vài phút (kéo image PostGIS, chạy toàn bộ migration, Caddy xin chứng chỉ).
Kiểm tra:

```bash
curl "https://${DOMAIN}/api/health"
# {"status":"ok",...,"dependencies":{"postgis":{"status":"up",...}}}
```

Mobile: đặt `EXPO_PUBLIC_API_BASE_URL=https://<DOMAIN>` (app tự thêm `/api`).

## Vận hành

Vào máy qua Session Manager (cần [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)):

```bash
aws ssm start-session --target "$INSTANCE_ID"
cd /opt/rong
sudo docker compose ps
sudo docker compose logs -f --tail 100 backend
cat .deployed-image              # image đang chạy
```

Quay về một bản cũ: Actions → chọn lần chạy của commit đó → **Re-run all jobs**
(image theo commit SHA vẫn còn trên Docker Hub).

## Chi phí

Trong thời gian free tier / credit của tài khoản, `t3.micro`, 20 GB EBS và
lưu lượng ra ở mức thấp gần như không tốn tiền. Ngoài free tier (ước lượng,
kiểm tra lại bảng giá): máy ~10 USD/tháng, EBS ~2 USD, IPv4 public ~3,6 USD
(AWS tính phí mọi IPv4 public, kể cả Elastic IP đang gắn vào máy).
Docker Hub, GitHub Actions, SSM Run Command, Parameter Store (standard) và
chứng chỉ Let's Encrypt đều miễn phí ở mức dùng này.
