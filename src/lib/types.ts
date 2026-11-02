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

// ---------------------------------------------------------------------------
// Jobs (phase 2)
// ---------------------------------------------------------------------------

// Where a job is: booked in, the stage being worked, then ready and collected.
export const JOB_STATUSES = [
  'Booked in', 'Wash Bay', 'Blast Room', 'Handling', 'Prep', 'Prime', 'Paint', 'QA', 'Ready for pickup', 'Collected',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** When a photo was taken: at intake, during a stage, at QA or on the way out. */
export type PhotoStage = 'Intake' | 'Wash Bay' | 'Blast Room' | 'Handling' | 'Prep' | 'Prime' | 'Paint' | 'QA' | 'Out';
export const PHOTO_STAGES: PhotoStage[] = ['Intake', 'Wash Bay', 'Blast Room', 'Handling', 'Prep', 'Prime', 'Paint', 'QA', 'Out'];

export interface Job {
  id: number;
  job_number: string;
  quote_number: string;
  po_number: string | null;
  customer_id: number;
  location_id: number | null;
  stage_ids: number[];
  status: JobStatus;
  note: string | null;
  date_in: string;
  date_out: string | null;
  created_by: string | null;
}

export interface JobItem {
  id: number;
  job_id: number;
  description: string;
  serial_number: string | null;
  quantity: number;
  note: string | null;
  added_by: string | null;
  added_at: string;
}

export interface JobPhoto {
  id: number;
  job_id: number;
  item_id: number | null;
  stage: PhotoStage;
  taken_by: string | null;
  taken_at: string;
  url: string; // ready to show (signed link or data URL)
}

export interface JobEvent {
  id: number;
  kind: string;
  detail: string;
  by_name: string | null;
  at: string;
}

/** A job as the yard board shows it. */
export interface JobCard extends Job {
  customer_name: string;
  location_name: string | null;
  items: Pick<JobItem, 'description' | 'serial_number' | 'quantity'>[];
  cover_url: string | null;
}

export interface JobDetail extends JobCard {
  created_by_name: string | null;
  item_rows: JobItem[];
  photos: JobPhoto[];
  events: JobEvent[];
}

export interface NewItem {
  description: string;
  serial_number: string | null;
  quantity: number;
  note: string | null;
  photos: Blob[];
}

export interface NewJob {
  quote_number: string;
  po_number: string | null;
  customer_id: number;
  location_id: number | null;
  stage_ids: number[];
  note: string | null;
  photos: Blob[];
  items: NewItem[];
}

export type JobPatch = Partial<Pick<Job,
  'quote_number' | 'po_number' | 'customer_id' | 'location_id' | 'stage_ids' | 'status' | 'note'>>;

// ---------------------------------------------------------------------------
// Labour hours (phase 3)
// ---------------------------------------------------------------------------

export interface LabourEntry {
  id: number;
  job_id: number;
  stage_id: number;
  staff_id: string;
  staff_name: string;
  work_date: string; // YYYY-MM-DD
  hours: number;
  labour_rate_id: number | null;
  note: string | null;
}

export interface NewLabour {
  job_id: number;
  stage_id: number;
  staff_id: string;
  work_date: string;
  hours: number;
  note: string | null;
  labour_rate_id?: number | null; // Office only
  client_ref?: string;
}

// ---------------------------------------------------------------------------
// Primer and topcoat usage (phase 4)
// ---------------------------------------------------------------------------

export interface PaintEntry {
  id: number;
  job_id: number;
  material_id: number;
  staff_id: string;
  staff_name: string;
  used_on: string; // YYYY-MM-DD
  litres: number;
  note: string | null;
}

export interface NewPaint {
  job_id: number;
  material_id: number;
  staff_id: string;
  used_on: string;
  litres: number;
  note: string | null;
  client_ref?: string;
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

  // Jobs
  jobs(opts: { includeCollected: boolean }): Promise<JobCard[]>;
  job(id: number): Promise<JobDetail>;
  /** Returns the new job's id and how many photos failed to upload (the job is saved either way). */
  createJob(j: NewJob): Promise<{ id: number; photoErrors: number }>;
  updateJob(id: number, patch: JobPatch): Promise<void>;
  /** Both return how many photos failed to upload. */
  addItem(jobId: number, item: NewItem): Promise<number>;
  addPhotos(jobId: number, photos: Blob[], opts: { stage: PhotoStage; itemId?: number | null }): Promise<number>;

  // Labour hours
  labour(jobId: number): Promise<LabourEntry[]>;
  logHours(e: NewLabour): Promise<void>;
  deleteHours(id: number): Promise<void>;

  // Primer and topcoat usage
  paint(jobId: number): Promise<PaintEntry[]>;
  logPaint(e: NewPaint): Promise<void>;
  deletePaint(id: number): Promise<void>;
}
