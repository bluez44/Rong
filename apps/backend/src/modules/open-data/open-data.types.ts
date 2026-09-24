export type OsmType = 'node' | 'way' | 'relation';

/** Một kết quả của Nominatim /search (format=jsonv2, addressdetails=1). */
export interface NominatimResult {
  osm_type: OsmType;
  osm_id: number;
  lat: string;
  lon: string;
  name: string;
  display_name: string;
  category: string;
  type: string;
  addresstype: string;
  /** [nam, bắc, tây, đông] dạng chuỗi. */
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Phần tử Overpass `out center tags`. */
export interface OverpassElement {
  type: OsmType;
  id: number;
  lat?: number;
  lon?: number;
  center?: LatLon;
  /** Có khi truy vấn dùng `out bb`. */
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

export interface WikidataInfo {
  sitelinks: number;
  description: string | null;
}

/** [south, west, north, east] theo thứ tự Overpass dùng. */
export type Bbox = [number, number, number, number];
