import * as z from 'zod';

export const Places = z.array(
  z.object({
    title: z.string().describe('The title of the place'),
    description: z.string().describe('A brief description of the place'),
    location: z.object({
      lat: z.number().describe('The latitude of the place'),
      lng: z.number().describe('The longitude of the place'),
    }).describe('The geographical location of the place'),
    tags: z.array(z.string()).describe('Tags associated with the place'),
    openHours: z.object({
      open: z.string().describe('Opening time in HH:mm format'),
      close: z.string().describe('Closing time in HH:mm format'),
    }).describe('The opening and closing hours of the place'),
  }),
);

export type PlacesType = z.infer<typeof Places>;