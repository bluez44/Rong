/** URL do expo-share-intent mở app (F4) không phải một màn: về trang chủ, `useIncomingShare` lo phần còn lại. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes('dataUrl=')) return '/';
  return path;
}
