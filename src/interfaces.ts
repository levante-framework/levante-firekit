import { FirebaseApp } from 'firebase/app';
import { Auth, User } from 'firebase/auth';
import { DocumentData, Firestore, Timestamp } from 'firebase/firestore';
import { Functions } from 'firebase/functions';
import { FirebaseStorage } from 'firebase/storage';
import { FirebasePerformance } from 'firebase/performance';
import { FirebaseConfig } from './firestore/util';

export interface RoarConfig {
  app: FirebaseConfig;
  admin: FirebaseConfig;
}

export interface FirebaseProject {
  firebaseApp: FirebaseApp;
  db: Firestore;
  auth: Auth;
  functions: Functions;
  storage: FirebaseStorage;
  perf?: FirebasePerformance;
  user?: User;
  claimsLastUpdated?: Date;
}

type Grade = number | 'K' | 'PK' | 'TK';

export enum UserType {
  admin = 'admin',
  super_admin = 'super_admin',
  student = 'student',
  caregiver = 'caregiver',
  teacher = 'teacher',
  guest = 'guest',
}

export interface ExtraMetadata extends DocumentData {
  [x: string]: unknown;
}

export interface StudentData extends ExtraMetadata {
  ell_status?: string;
  frl_status?: string;
  iep_status?: string;
  dob: Date;
  gender?: string;
  grade: Grade;
}

export interface AdministratorData extends DocumentData {
  administrationsCreated: string[];
  permissions: string[];
}

export interface ExternalUserData extends DocumentData {
  [x: string]: unknown;
}

export interface AssignmentDateMap {
  [x: string]: Date;
}

export interface RoarOrgDateMap {
  [x: string]: { from: Date; to?: Date };
}

export interface Orgs {
  current: string[];
  all: string[];
  dates: RoarOrgDateMap;
}

export interface Name {
  first: string;
  middle?: string;
  last: string;
}

export interface UserDataInAdminDb extends DocumentData {
  id?: string;
  userType: UserType;
  name?: Name;
  assessmentPid?: string;
  assessmentUid?: string;
  assessmentsCompleted?: string[];
  assessmentsAssigned?: string[];
  assignmentsAssigned?: AssignmentDateMap;
  assignmentsStarted?: AssignmentDateMap;
  assignmentsCompleted?: AssignmentDateMap;
  classes: Orgs;
  schools: Orgs;
  districts: Orgs;
  groups: Orgs;
  families: Orgs;
  archived: boolean;
  testData?: boolean;
  demoData?: boolean;
  studentData?: StudentData;
  educatorData?: ExtraMetadata;
  caregiverData?: ExtraMetadata;
  adminData?: AdministratorData;
  // Allow for data from external resources like clever or state-wide tests
  externalData?: {
    [x: string]: ExternalUserData;
  };
}

export interface UserRecord {
  email?: string;
  phoneNumber?: string;
  emailVerified?: string;
  password?: string;
  displayName?: string;
  photoURL?: string;
  disabled?: boolean;
}

export interface Legal {
  consent: [];
  assent: [];
  amount: string;
  expectedTime: string;
}

enum Operator {
  LESS_THAN = 'LESS_THAN',
  GREATER_THAN = 'GREATER_THAN',
  LESS_THAN_OR_EQUAL = 'LESS_THAN_OR_EQUAL',
  GREATER_THAN_OR_EQUAL = 'GREATER_THAN_OR_EQUAL',
  EQUAL = 'EQUAL',
  NOT_EQUAL = 'NOT_EQUAL',
}

interface FieldCondition {
  field: string;
  op: Operator;
  value: boolean | number | string | Date;
}

interface CompositeCondition {
  op: 'AND' | 'OR';
  conditions: Condition[];
}

type SelectAllCondition = true;

export type Condition = FieldCondition | CompositeCondition | SelectAllCondition;

export interface Assessment extends DocumentData {
  taskId: string;
  params: { [x: string]: unknown };
  variantId: string;
  variantName: string;
  conditions?: {
    optional?: Condition;
    assigned?: Condition;
  };
}

export interface OrgLists extends DocumentData {
  districts: string[];
  schools: string[];
  classes: string[];
  groups: string[];
  families: string[];
}

export type OrgListKey = 'districts' | 'schools' | 'classes' | 'groups' | 'families';

export interface Administration extends OrgLists {
  id?: string;
  name: string;
  publicName?: string;
  createdBy: string;
  dateCreated: Date | Timestamp;
  dateOpened: Date | Timestamp;
  dateClosed: Date | Timestamp;
  sequential: boolean;
  assessments: Assessment[];
  tags?: string[];
  readOrgs?: OrgLists;
  legal?: Legal;
}

export interface AssignedAssessment extends DocumentData {
  taskId: string;
  runId?: string;
  allRunIds?: string[];
  completedOn?: Date;
  startedOn?: Date;
  rewardShown: boolean;
  [x: string]: unknown;
  optional?: boolean;
  params: { [x: string]: unknown };
}

export interface Assignment extends DocumentData {
  assignmentId?: string;
  completed: boolean;
  started: boolean;
  dateAssigned: Date;
  dateOpened: Date;
  dateClosed: Date;
  assigningOrgs: OrgLists;
  readOrgs: OrgLists;
  assessments: AssignedAssessment[];
}

export interface District extends DocumentData {
  name: string;
  schools: string[];
  [x: string]: unknown;
}

export interface School extends DocumentData {
  name: string;
  districtId: string;
  classes: string[];
  [x: string]: unknown;
}

export interface Class extends DocumentData {
  name: string;
  schoolId: string;
  districtId: string;
  grade: Grade;
  [x: string]: unknown;
}

export interface Family extends DocumentData {
  name: string;
  [x: string]: unknown;
}

export interface Group extends DocumentData {
  name: string;
  [x: string]: unknown;
}

export type RoarOrg = District | School | Class | Family | Group;

export type OrgType = 'district' | 'school' | 'class' | 'family' | 'group';
export type OrgCollectionName = 'districts' | 'schools' | 'classes' | 'families' | 'groups';

export interface StartTaskResult {
  success: boolean;
  taskInfo: {
    variantName: string;
    variantParams: { [x: string]: unknown };
    variantId: string;
  };
  assigningOrgs: OrgLists;
  readOrgs: OrgLists;
  userData: UserDataInAdminDb;
  assessmentPid: string;
}
