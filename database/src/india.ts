/** Indian reference data shared by backend and frontend. */

/** GST state / UT codes (first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '96': 'Foreign Country',
};

/** GST rates in use (%), including the 40% slab introduced by GST 2.0 (Sept 2025). 12/28 kept for legacy items. */
export const GST_RATES = ['0', '0.1', '0.25', '1.5', '3', '5', '12', '18', '28', '40'] as const;

/** GST Unique Quantity Codes (for e-invoice / GSTR-1 HSN summary). Subset commonly used in manufacturing. */
export const GST_UQC: Record<string, string> = {
  BAG: 'Bags',
  BAL: 'Bale',
  BDL: 'Bundles',
  BOT: 'Bottles',
  BOX: 'Box',
  BTL: 'Bottles',
  BUN: 'Bunches',
  CAN: 'Cans',
  CBM: 'Cubic meters',
  CCM: 'Cubic centimeters',
  CMS: 'Centimeters',
  CTN: 'Cartons',
  DOZ: 'Dozens',
  DRM: 'Drums',
  GMS: 'Grammes',
  GRS: 'Gross',
  KGS: 'Kilograms',
  KLR: 'Kilolitre',
  KME: 'Kilometre',
  LTR: 'Litres',
  MLT: 'Millilitre',
  MTR: 'Meters',
  MTS: 'Metric ton',
  NOS: 'Numbers',
  OTH: 'Others',
  PAC: 'Packs',
  PCS: 'Pieces',
  PRS: 'Pairs',
  QTL: 'Quintal',
  ROL: 'Rolls',
  SET: 'Sets',
  SQF: 'Square feet',
  SQM: 'Square meters',
  TBS: 'Tablets',
  THD: 'Thousands',
  TON: 'Tonnes',
  TUB: 'Tubes',
  UNT: 'Units',
};

/** Standard units created for every new workspace: [code, name, decimals, UQC]. */
export const DEFAULT_UOMS: [string, string, number, string][] = [
  ['NOS', 'Numbers', 0, 'NOS'],
  ['PCS', 'Pieces', 0, 'PCS'],
  ['SET', 'Sets', 0, 'SET'],
  ['PAIR', 'Pairs', 0, 'PRS'],
  ['BOX', 'Box', 0, 'BOX'],
  ['CTN', 'Carton', 0, 'CTN'],
  ['BAG', 'Bag', 0, 'BAG'],
  ['DRUM', 'Drum', 0, 'DRM'],
  ['ROLL', 'Roll', 0, 'ROL'],
  ['KG', 'Kilogram', 3, 'KGS'],
  ['G', 'Gram', 3, 'GMS'],
  ['MT', 'Metric tonne', 3, 'MTS'],
  ['LTR', 'Litre', 3, 'LTR'],
  ['ML', 'Millilitre', 3, 'MLT'],
  ['MTR', 'Metre', 3, 'MTR'],
  ['CM', 'Centimetre', 2, 'CMS'],
  ['SQM', 'Square metre', 3, 'SQM'],
  ['SQFT', 'Square feet', 3, 'SQF'],
  ['CBM', 'Cubic metre', 3, 'CBM'],
  ['HR', 'Hour', 2, 'OTH'],
];

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Validates a GSTIN including its check digit (mod-36 algorithm used by GSTN).
 * Returns an error message or null when valid.
 */
export function gstinError(gstin: string): string | null {
  const g = gstin.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return 'Enter a valid 15-character GSTIN';
  if (!(g.slice(0, 2) in GST_STATES)) return 'GSTIN has an unknown state code';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(g[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14] ? null : 'GSTIN check digit is wrong. Please re-check the number.';
}

/** PAN embedded in a GSTIN (characters 3–12). */
export function panFromGstin(gstin: string) {
  return gstin.slice(2, 12).toUpperCase();
}

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export const HSN_REGEX = /^(\d{4}|\d{6}|\d{8})$/;
