export interface LocationV1 {
    schemaVersion: 'location_v1';
    latLon: {
      lat: number;
      lon: number;
      source: 'h3_center';
    };
    scheme: 'h3_v1';
    h3CellId: string;
    h3Cellresolution: number;
    populationThreshold: number;
    populationSource: 'kontur' | 'worldpop' | 'unknown';
    computedAt: string;
}
