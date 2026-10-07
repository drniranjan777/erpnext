export const HR = "/hr";

export interface OrgRow { id: string; code: string; name: string; isActive: boolean; employees: number; parentId?: string | null; gradeId?: string | null; stateCode?: string; isFactory?: boolean; minSalary?: string | null; maxSalary?: string | null; level?: number; latitude?: string | null; longitude?: string | null; radiusMetres?: number | null; costCentre?: string | null }

export interface FamilyMember { id?: string; name: string; relation: string; dateOfBirth: string | null; isDependent: boolean; nomineeFor: string[]; nomineeSharePct: string | null }
export interface EmployeeEvent { id: string; kind: string; effectiveDate: string; from: Record<string, string | null>; to: Record<string, string | null>; remarks: string | null }

export interface Employee {
  id: string;
  code: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  maritalStatus: string | null;
  fatherOrSpouseName: string | null;
  personalEmail: string | null;
  mobile: string | null;
  currentAddress: Record<string, string>;
  permanentAddress: Record<string, string>;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  dateOfJoining: string;
  probationEnd: string | null;
  confirmedOn: string | null;
  employmentType: string;
  category: string;
  departmentId: string | null;
  designationId: string | null;
  gradeId: string | null;
  locationId: string | null;
  reportsToId: string | null;
  department?: string;
  designation?: string;
  grade?: string;
  location?: string;
  manager?: string;
  userId: string | null;
  login: string | null;
  workEmail: string | null;
  noticeDays: number;
  status: "active" | "notice" | "exited";
  exitDate: string | null;
  exitReason: string | null;
  panMasked: string | null;
  aadhaarLast4: string | null;
  uan: string | null;
  pfNumber: string | null;
  esicNumber: string | null;
  bankName: string | null;
  bankAccountLast4: string | null;
  ifsc: string | null;
  hasPan: boolean;
  hasAadhaar: boolean;
  hasBankAccount: boolean;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  lwfApplicable: boolean;
  taxRegime: "new" | "old";
  version: number;
  family: FamilyMember[];
  events: EmployeeEvent[];
  documents: { id: string; kind: string; title: string; expiryDate: string | null; fileName: string; createdAt: string }[];
  letters: { id: string; kind: string; title: string; issuedOn: string }[];
  reports: { id: string; code: string; fullName: string }[];
  canSeeSensitive: boolean;
  canManage: boolean;
}

export const STATUS_TONE = { active: "success", notice: "warning", exited: "neutral" } as const;
export const EVENT_LABEL: Record<string, string> = { joined: "Joined", transfer: "Transfer", promotion: "Promotion", redesignation: "Re-designation", confirmation: "Confirmed", increment: "Increment", exit: "Exit" };

export interface LeaveType { id: string; code: string; name: string; isPaid: boolean; accrual: string; annualQuota: string; daysWorkedPerLeave: number | null; carryForwardMax: string; encashable: boolean; encashMax: string | null; allowHalfDay: boolean; allowNegative: boolean; countHolidays: boolean; isCompOff: boolean; gender: string | null; isActive: boolean }
export interface LeaveBalance { employeeId: string; code: string; fullName: string; leaveTypeId: string; typeCode: string; typeName: string; isPaid: boolean; opening: number; credited: number; availed: number; closedOut: number; balance: number; balanceNow: number; pending: number }
