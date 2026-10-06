/** API response shapes (mirrors @nextgen/database schema; dates arrive as ISO strings). */

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  district?: string;
  stateCode?: string;
  pincode?: string;
  country?: string;
}

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  legalName: string | null;
  pan: string | null;
  gstin: string | null;
  stateCode: string | null;
  address: Address;
  baseCurrency: string;
  fyStartMonth: number;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  companyId: string;
  code: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  isActive: boolean;
}
