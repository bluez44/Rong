import { Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class WeatherQueryDto {
  @Matches(DAY, { message: 'from phải có dạng YYYY-MM-DD' })
  from!: string;

  @Matches(DAY, { message: 'to phải có dạng YYYY-MM-DD' })
  to!: string;
}
