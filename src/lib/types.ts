export type Group = 'office' | 'yard' | 'blaster' | 'painter' | 'qa';

export const GROUP_LABELS: Record<Group, string> = {
  office: 'Office',
  yard: 'Yardman',
  blaster: 'Blaster',
  painter: 'Painter',
  qa: 'QA',
};

export interface Staff {
  id: string;
  name: string;
  mobile: string;
  groups: Group[];
  active: boolean;
}

export interface Stage {
  id: number;
  name: string;
  sort_order: number;
}

export interface Customer {
  id?: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

export interface YardLocation {
  id?: number;
  name: string;
  sort_order: number;
  active: boolean;
}

export interface Material {
  id?: number;
  name: string;
  type: 'primer' | 'topcoat';
  manufacturer: string | null;
  sds_url: string | null;
  pds_url: string | null;
  sds_status: string | null;
  notes: string | null;
  active: boolean;
  // Office only: undefined for everyone else.
  cost_per_l?: number;
  charge_per_l?: number;
}

export interface LabourRate {
  id?: number;
  name: string;
  stage_id: number;
  cost_per_hour: number;
  charge_per_hour: number;
  is_default: boolean;
  active: boolean;
}

export interface Extra {
  id?: number;
  name: string;
  unit_cost: number;
  unit_charge: number;
  active: boolean;
}

export interface Tables {
  customers: Customer;
  yard_locations: YardLocation;
  materials: Material;
  labour_rates: LabourRate;
  extras: Extra;
}
export type TableName = keyof Tables;

export interface NewStaff {
  name: string;
  mobile: string;
  groups: Group[];
  pin: string;
}

export interface Api {
  mode: 'live' | 'demo';
  restore(): Promise<Staff | null>;
  signIn(mobile: string, pin: string): Promise<Staff>;
  signOut(): Promise<void>;
  stages(): Promise<Stage[]>;
  list<K extends TableName>(table: K): Promise<Tables[K][]>;
  save<K extends TableName>(table: K, row: Tables[K]): Promise<void>;
  staff(): Promise<Staff[]>;
  createStaff(s: NewStaff): Promise<void>;
  updateStaff(s: Staff): Promise<void>;
  setPin(staffId: string, pin: string): Promise<void>;
}
