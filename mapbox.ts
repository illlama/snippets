import { URL_MAPBOX, URL_MAPBOX_PLACES } from '@/constants';
import { MAPBOX_ACCESS_TOKEN } from '@env'; // injected at build time, not a literal secret
import axios from 'axios';

const tilebelt = require('@mapbox/tilebelt');

type LocationType = { latitude: number; longitude: number };

// Minimal shape of the Mapbox Geocoding API response we rely on.
interface MapboxContext {
  id: string;
  text: string;
  short_code?: string;
}

interface MapboxFeature {
  id: string;
  place_type?: string[];
  text: string;
  place_name?: string;
  properties?: { short_code?: string };
  context?: MapboxContext[];
}

interface MapboxGeocodeResponse {
  features: MapboxFeature[];
}

export const getReverseGeocode = async ({ longitude, latitude }: { longitude: number; latitude: number }) => {
  try {
    const { data } = await axios.get<MapboxGeocodeResponse>(
      `${URL_MAPBOX}${URL_MAPBOX_PLACES}/${longitude},${latitude}.json`,
      {
        params: {
          access_token: MAPBOX_ACCESS_TOKEN,
          language: 'en'
        }
      }
    );

    return data.features[0]?.place_name;
  } catch (error) {
    console.error('getReverseGeocode failed:', error);
  }
};

/**
 * Reverse-geocode a coordinate into structured place parts.
 *
 * Mapbox returns a list of `features` ordered most- to least-specific, and each
 * feature also carries a `context` array of broader enclosing places. A given
 * place type (neighborhood, place, region, country, …) can therefore live either
 * as a top-level feature OR inside another feature's context — so each lookup
 * falls back from features → context, and adjacent types fall back to each other
 * (neighborhood → macrohood → borough, street → address, region → district).
 * This lets the UI render the right granularity per zoom level without depending
 * on Mapbox's `types` query parameter.
 */
export const getReverseGeocodeParts = async ({
  longitude,
  latitude,
  zoom
}: {
  longitude: number;
  latitude: number;
  zoom?: number;
}): Promise<{
  neighborhoodOrStreet: string | null;
  city: string | null;
  region: string | null;
  locality: string | null;
  country: string | null;
  countryCode: string | null;
}> => {
  try {
    const { data } = await axios.get<MapboxGeocodeResponse>(
      `${URL_MAPBOX}${URL_MAPBOX_PLACES}/${longitude},${latitude}.json`,
      {
        params: {
          access_token: MAPBOX_ACCESS_TOKEN,
          language: 'en'
        }
      }
    );

    const features: MapboxFeature[] = Array.isArray(data?.features) ? data.features : [];
    const allContexts: MapboxContext[] = features.flatMap((f) => f.context ?? []);

    const pickFromFeatures = (type: string) => features.find((f) => f.place_type?.includes(type))?.text ?? null;
    const pickFromContext = (type: string) =>
      allContexts.find((c) => c.id.startsWith(`${type}.`))?.text ?? null;
    const pickText = (type: string) => pickFromFeatures(type) || pickFromContext(type);

    const neighborhood = pickText('neighborhood') || pickText('macrohood') || pickText('borough');
    const street = pickText('street') || pickText('address');
    const locality = pickText('locality');
    const city = pickText('place') || pickFromContext('place');
    const region = pickText('region') || pickText('district') || pickFromContext('region');
    // Country name (text)
    const country = pickText('country');
    const countryShort =
      features.find((f) => f.place_type?.includes('country'))?.properties?.short_code ??
      allContexts.find((c) => c.id.startsWith('country.'))?.short_code ??
      null;
    const countryCode = countryShort ? countryShort.toUpperCase() : null;

    // We return full parts so the UI can pick what to display per zoom level
    // without relying on Mapbox `types`.
    return {
      neighborhoodOrStreet: neighborhood || street || null,
      city: city || null,
      region: region || null,
      locality: locality || null,
      country: country || null,
      countryCode
    };
  } catch (error) {
    console.error('getReverseGeocodeParts failed:', error);
    return { neighborhoodOrStreet: null, city: null, region: null, locality: null, country: null, countryCode: null };
  }
};

/**
 * Great-circle distance between two coordinates using the Haversine formula.
 * Returns the distance in kilometers and whether it is within `targetDistance`
 * (default 0.5km) — used to decide if a user is "close enough" to a pin to interact.
 */
export const calculateDistance = (
  location1?: LocationType | null,
  location2?: LocationType | null,
  targetDistance?: number
) => {
  if (!location1 || !location2) return { isClose: false, distance: -999 };
  const R = 6371.0; // Earth radius in km

  const radLat1 = (Math.PI / 180) * location1.latitude;
  const radLon1 = (Math.PI / 180) * location1.longitude;
  const radLat2 = (Math.PI / 180) * location2.latitude;
  const radLon2 = (Math.PI / 180) * location2.longitude;

  const dLon = radLon2 - radLon1;
  const dLat = radLat2 - radLat1;

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c;

  return {
    isClose: distance <= (targetDistance || 0.5),
    distance
  };
};

/** Convert a lng/lat point to the quadkey of the tile containing it at a given zoom. */
export const locationToQuadKey = (longitude: number, latitude: number, flooredZoom: string): string => {
  const tile = tilebelt.pointToTile(longitude, latitude, flooredZoom);
  const quadKey = tilebelt.tileToQuadkey(tile);
  return quadKey;
};

/**
 * Return every tile quadkey covering the current viewport bounds at zoom `z`.
 * Walks the tile grid between the SW and NE corners and caps the result at
 * `maxCount` so a zoomed-out viewport can't explode into thousands of fetches.
 */
export const tilesInBounds = (
  bounds: { ne: [number, number]; sw: [number, number] },
  z: number,
  maxCount: number = 24
): string[] => {
  try {
    const swTile = tilebelt.pointToTile(bounds.sw[0], bounds.sw[1], z);
    const neTile = tilebelt.pointToTile(bounds.ne[0], bounds.ne[1], z);

    const xMin = Math.min(swTile[0], neTile[0]);
    const xMax = Math.max(swTile[0], neTile[0]);
    const yMin = Math.min(swTile[1], neTile[1]);
    const yMax = Math.max(swTile[1], neTile[1]);

    const quadKeys: string[] = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        quadKeys.push(tilebelt.tileToQuadkey([x, y, z]));
        if (quadKeys.length >= maxCount) return quadKeys;
      }
    }
    return quadKeys;
  } catch (e) {
    console.error('tilesInBounds error', e);
    return [];
  }
};
