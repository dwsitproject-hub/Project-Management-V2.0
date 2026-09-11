import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres123@localhost:5544/project_management_v2';

const pool = new Pool({ connectionString: databaseUrl });
let initialized = false;

async function initializeSchema() {
  if (initialized) return;
  initialized = true;
  const client = await pool.connect();
  try {
    const ddl = `
      CREATE TABLE IF NOT EXISTS "departments" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "email" TEXT,
        "role" TEXT,
        "type" TEXT,
        "departmentId" TEXT,
        "active" BOOLEAN DEFAULT TRUE,
        "passwordHash" TEXT,
        "isAdmin" BOOLEAN DEFAULT FALSE,
        "emailActivated" BOOLEAN DEFAULT FALSE,
        "activationToken" TEXT,
        "activationTokenExpiry" TEXT,
        "resetToken" TEXT,
        "resetTokenExpiry" TEXT,
        "teamMemberIds" TEXT
      );
      -- Ensure missing user columns/constraints exist (or are relaxed) for compatibility
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active" BOOLEAN DEFAULT TRUE;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN DEFAULT FALSE;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailActivated" BOOLEAN DEFAULT FALSE;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activationToken" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activationTokenExpiry" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "type" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "teamMemberIds" TEXT;
      CREATE TABLE IF NOT EXISTS "initiatives" (
        "id" TEXT PRIMARY KEY,
        "type" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "ticket" TEXT,
        "description" TEXT,
        "businessImpact" TEXT,
        "priority" TEXT,
        "businessOwnerId" TEXT,
        "businessUserIds" TEXT,
        "departmentId" TEXT,
        "itPicId" TEXT,
        "itPicIds" TEXT,
        "itPmId" TEXT,
        "itManagerIds" TEXT,
        "systemImpactedIds" TEXT,
        "status" TEXT,
        "milestone" TEXT,
        "crMilestonePhase" TEXT,
        "startDate" TEXT,
        "endDate" TEXT,
        "planStartDate" TEXT,
        "planEndDate" TEXT,
        "remark" TEXT,
        "documentationLink" TEXT,
        "createdAt" TEXT,
        "updatedAt" TEXT
      );
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "ticket" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "businessImpact" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "priority" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "businessOwnerId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "businessUserIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itPicId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itPicIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itPmId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itManagerIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "systemImpactedIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "milestone" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "crMilestonePhase" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "startDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "endDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "planStartDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "planEndDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "remark" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "documentationLink" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "changeRequests" (
        "initiativeId" TEXT PRIMARY KEY,
        "crSubmissionStart" TEXT,
        "crSubmissionEnd" TEXT,
        "developmentStart" TEXT,
        "developmentEnd" TEXT,
        "sitStart" TEXT,
        "sitEnd" TEXT,
        "uatStart" TEXT,
        "uatEnd" TEXT,
        "liveDate" TEXT,
        "crSection1Start" TEXT,
        "crSection1End" TEXT,
        "crSection2Start" TEXT,
        "crSection2End" TEXT,
        "crSection3Start" TEXT,
        "crSection3End" TEXT,
        "liveStart" TEXT,
        "liveEnd" TEXT
      );
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSubmissionStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSubmissionEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "developmentStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "developmentEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "sitStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "sitEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "uatStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "uatEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "liveDate" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection1Start" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection1End" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection2Start" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection2End" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection3Start" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection3End" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "liveStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "liveEnd" TEXT;
      CREATE TABLE IF NOT EXISTS "tags" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL
      );
      ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "name" TEXT;
      CREATE TABLE IF NOT EXISTS "initiativeTags" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "tagId" TEXT NOT NULL
      );
      ALTER TABLE "initiativeTags" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "initiativeTags" ADD COLUMN IF NOT EXISTS "tagId" TEXT;
      CREATE TABLE IF NOT EXISTS "statusHistory" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "changedAt" TEXT NOT NULL,
        "changedBy" TEXT
      );
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      CREATE TABLE IF NOT EXISTS "milestoneHistory" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "milestone" TEXT NOT NULL,
        "changedAt" TEXT NOT NULL,
        "changedBy" TEXT
      );
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "milestone" TEXT;
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      CREATE TABLE IF NOT EXISTS "changeHistory" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "timestamp" TEXT NOT NULL,
        "changedBy" TEXT
      );
      ALTER TABLE "changeHistory" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "changeHistory" ADD COLUMN IF NOT EXISTS "timestamp" TEXT;
      ALTER TABLE "changeHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      CREATE TABLE IF NOT EXISTS "changeHistoryItem" (
        "id" TEXT PRIMARY KEY,
        "changeHistoryId" TEXT NOT NULL,
        "field" TEXT NOT NULL,
        "oldValue" TEXT,
        "newValue" TEXT,
        "changedAt" TEXT NOT NULL
      );
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "changeHistoryId" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "field" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "oldValue" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "newValue" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "comments" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "authorId" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT
      );
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "authorId" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "body" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "tasks" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "startDate" TEXT,
        "endDate" TEXT,
        "assigneeId" TEXT,
        "status" TEXT,
        "milestone" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT
      );
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "name" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "description" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "startDate" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "endDate" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigneeId" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "milestone" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "documents" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "filePath" TEXT NOT NULL,
        "sizeBytes" INTEGER NOT NULL,
        "uploadedBy" TEXT NOT NULL,
        "uploadedAt" TEXT NOT NULL
      );
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "filePath" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "uploadedBy" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "uploadedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "initiativeId" TEXT,
        "commentId" TEXT,
        "read" BOOLEAN DEFAULT FALSE,
        "createdAt" TEXT NOT NULL
      );
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "userId" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "message" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "commentId" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read" BOOLEAN DEFAULT FALSE;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      CREATE TABLE IF NOT EXISTS "accessRules" (
        "id" TEXT PRIMARY KEY,
        "role" TEXT,
        "type" TEXT,
        "emailDomain" TEXT,
        "canViewProjectDashboard" BOOLEAN,
        "canViewProjectList" BOOLEAN,
        "canCreateProject" BOOLEAN,
        "canEditAnyProject" BOOLEAN,
        "restrictProjectVisibilityToOwnTeamOnly" BOOLEAN,
        "restrictProjectEditToOwnTeamOnly" BOOLEAN,
        "canViewCRDashboard" BOOLEAN,
        "canViewCRList" BOOLEAN,
        "canCreateCR" BOOLEAN,
        "canEditCR" BOOLEAN,
        "canViewMasterDwsApplication" BOOLEAN,
        "canViewManagementDashboard" BOOLEAN
      );
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "role" TEXT;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "type" TEXT;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "emailDomain" TEXT;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewProjectDashboard" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewProjectList" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canCreateProject" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canEditAnyProject" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "restrictProjectVisibilityToOwnTeamOnly" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "restrictProjectEditToOwnTeamOnly" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewCRDashboard" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewCRList" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canCreateCR" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canEditCR" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewMasterDwsApplication" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewManagementDashboard" BOOLEAN;

      CREATE TABLE IF NOT EXISTS "apiClients" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "clientId" TEXT NOT NULL,
        "clientSecretHash" TEXT NOT NULL,
        "scopes" TEXT,
        "active" BOOLEAN DEFAULT TRUE,
        "createdAt" TEXT NOT NULL
      );
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "name" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "clientSecretHash" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "scopes" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "active" BOOLEAN DEFAULT TRUE;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;

      CREATE TABLE IF NOT EXISTS "dwsApplications" (
        "id" TEXT PRIMARY KEY,
        "systemName" TEXT NOT NULL,
        "productionUrl" TEXT,
        "stagingUrl" TEXT,
        "githubUrl" TEXT,
        "deploymentSteps" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "systemName" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "productionUrl" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "stagingUrl" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "githubUrl" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "deploymentSteps" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;

      CREATE TABLE IF NOT EXISTS "managementDashboard" (
        "id" TEXT PRIMARY KEY,
        "portfolioStatus" TEXT,
        "highlights" TEXT,
        "criticalAlerts" TEXT,
        "updatedBy" TEXT,
        "updatedAt" TEXT NOT NULL
      );
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "portfolioStatus" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "highlights" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "criticalAlerts" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "meetingNotes" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "meetingType" TEXT NOT NULL,
        "meetingDate" TEXT NOT NULL,
        "location" TEXT,
        "meetingLink" TEXT,
        "facilitatorId" TEXT NOT NULL,
        "noteTakerId" TEXT NOT NULL,
        "agenda" TEXT,
        "discussion" TEXT,
        "decisions" TEXT,
        "risks" TEXT,
        "nextMeetingAt" TEXT,
        "status" TEXT NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "createdBy" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL,
        "deletedAt" TEXT
      );
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "deletedAt" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "title" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "meetingType" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "meetingDate" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "location" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "meetingLink" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "facilitatorId" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "noteTakerId" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "agenda" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "discussion" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "decisions" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "risks" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "nextMeetingAt" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      UPDATE "meetingNotes" SET "status" = 'Published' WHERE "status" IN ('Sent', 'Archived');
      CREATE TABLE IF NOT EXISTS "meetingNoteParticipants" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "userId" TEXT,
        "email" TEXT,
        "name" TEXT,
        "role" TEXT NOT NULL
      );
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "userId" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "email" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "name" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "role" TEXT;
      CREATE TABLE IF NOT EXISTS "meetingNoteActionItems" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "ownerId" TEXT,
        "ownerName" TEXT,
        "dueDate" TEXT,
        "priority" TEXT,
        "status" TEXT NOT NULL,
        "orderIndex" INTEGER NOT NULL DEFAULT 0
      );
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "description" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "ownerName" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "dueDate" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "priority" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "orderIndex" INTEGER DEFAULT 0;
      CREATE TABLE IF NOT EXISTS "meetingNoteEmailLog" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "subject" TEXT NOT NULL,
        "toEmails" TEXT NOT NULL,
        "ccEmails" TEXT,
        "bodySnapshot" TEXT NOT NULL,
        "sentBy" TEXT NOT NULL,
        "sentAt" TEXT NOT NULL,
        "deliveryStatus" TEXT NOT NULL,
        "providerMessageId" TEXT,
        "errorMessage" TEXT
      );
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "subject" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "toEmails" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "ccEmails" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "bodySnapshot" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "sentBy" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "sentAt" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
      CREATE TABLE IF NOT EXISTS "meetingNoteHistory" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "version" INTEGER NOT NULL,
        "field" TEXT NOT NULL,
        "oldValue" TEXT,
        "newValue" TEXT,
        "changedBy" TEXT NOT NULL,
        "changedAt" TEXT NOT NULL
      );
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "version" INTEGER;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "field" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "oldValue" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "newValue" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;
    `;
    await client.query(ddl);
  } finally {
    client.release();
  }
}

async function read() {
  await initializeSchema();
  const client = await pool.connect();
  try {
    const data = {};
    const tables = [
      'departments',
      'users',
      'initiatives',
      'changeRequests',
      'tags',
      'initiativeTags',
      'statusHistory',
      'milestoneHistory',
      'comments',
      'tasks',
      'documents',
      'notifications',
      'accessRules',
      'apiClients',
      'dwsApplications',
      'managementDashboard',
      'meetingNotes',
      'meetingNoteParticipants',
      'meetingNoteActionItems',
      'meetingNoteEmailLog',
      'meetingNoteHistory',
    ];
    for (const table of tables) {
      const res = await client.query(`SELECT * FROM "${table}"`);
      // Transform PostgreSQL column names to camelCase for users table
      // Note: PostgreSQL preserves case for quoted identifiers, so "isAdmin" returns as isAdmin
      if (table === 'users') {
        data[table] = res.rows.map(row => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          departmentId: row.departmentId || row.departmentid,
          active: row.active,
          passwordHash: row.passwordHash || row.passwordhash,
          isAdmin: !!(row.isAdmin !== undefined ? row.isAdmin : row.isadmin), // Handle both cases
          emailActivated: row.emailActivated !== undefined ? row.emailActivated : (row.emailactivated !== undefined ? row.emailactivated : false),
          activationToken: row.activationToken || row.activationtoken || null,
          activationTokenExpiry: row.activationTokenExpiry || row.activationtokenexpiry || null,
          resetToken: row.resetToken || row.resettoken || null,
          resetTokenExpiry: row.resetTokenExpiry || row.resettokenexpiry || null,
          type: row.type || null,
          teamMemberIds: row.teamMemberIds || row.teammemberids ? (row.teamMemberIds || row.teammemberids).split(',').filter(Boolean) : [],
          createdAt: row.createdAt || row.createdat || null
        }));
      } else if (table === 'initiatives') {
        // Transform initiatives and parse comma-separated arrays
        data[table] = res.rows.map(row => ({
          id: row.id,
          type: row.type,
          name: row.name,
          ticket: row.ticket || null,
          description: row.description || null,
          businessImpact: row.businessImpact || row.businessimpact || null,
          priority: row.priority || null,
          businessOwnerId: row.businessOwnerId || row.businessownerid || null,
          businessUserIds: row.businessUserIds || row.businessuserids ? (row.businessUserIds || row.businessuserids).split(',').filter(Boolean) : [],
          departmentId: row.departmentId || row.departmentid || null,
          itPicId: row.itPicId || row.itpicid || null, // Keep for backward compatibility
          itPicIds: row.itPicIds || row.itpicids ? (row.itPicIds || row.itpicids).split(',').filter(Boolean) : (row.itPicId || row.itpicid ? [row.itPicId || row.itpicid] : []),
          itPmId: row.itPmId || row.itpmid || null,
          itManagerIds: row.itManagerIds || row.itmanagerids ? (row.itManagerIds || row.itmanagerids).split(',').filter(Boolean) : [],
          systemImpactedIds: row.systemImpactedIds || row.systemimpactedids ? (row.systemImpactedIds || row.systemimpactedids).split(',').filter(Boolean) : [],
          status: row.status || null,
          milestone: row.milestone || null,
          crMilestonePhase: row.crMilestonePhase || row.crmilestonephase || null,
          startDate: row.startDate || row.startdate || null,
          endDate: row.endDate || row.enddate || null,
          planStartDate: row.planStartDate || row.planstartdate || null,
          planEndDate: row.planEndDate || row.planenddate || null,
          remark: row.remark || null,
          documentationLink: row.documentationLink || row.documentationlink || null,
          createdAt: row.createdAt || row.createdat || null,
          updatedAt: row.updatedAt || row.updatedat || null
        }));
      } else if (table === 'notifications') {
        // Transform notifications
        data[table] = res.rows.map(row => ({
          id: row.id,
          userId: row.userId || row.userid,
          type: row.type,
          title: row.title,
          message: row.message,
          initiativeId: row.initiativeId || row.initiativeid || null,
          commentId: row.commentId || row.commentid || null,
          read: row.read !== undefined ? !!row.read : false,
          createdAt: row.createdAt || row.createdat
        }));
      } else if (table === 'accessRules') {
        data[table] = res.rows;
      } else if (table === 'apiClients') {
        data[table] = res.rows.map((row) => ({
          id: row.id,
          name: row.name,
          clientId: row.clientId || row.clientid,
          clientSecretHash: row.clientSecretHash || row.clientsecrethash,
          scopes: row.scopes || null,
          active: row.active !== undefined ? !!row.active : true,
          createdAt: row.createdAt || row.createdat,
        }));
      } else if (table === 'dwsApplications') {
        data[table] = res.rows.map((row) => ({
          id: row.id,
          systemName: row.systemName || row.systemname,
          productionUrl: row.productionUrl || row.productionurl || null,
          stagingUrl: row.stagingUrl || row.stagingurl || null,
          githubUrl: row.githubUrl || row.githuburl || null,
          deploymentSteps: row.deploymentSteps || row.deploymentsteps || null,
          createdAt: row.createdAt || row.createdat,
          updatedAt: row.updatedAt || row.updatedat,
        }));
      } else if (table === 'managementDashboard') {
        data[table] = res.rows.map((row) => ({
          id: row.id,
          portfolioStatus: row.portfolioStatus || row.portfoliostatus || null,
          highlights: row.highlights || null,
          criticalAlerts: row.criticalAlerts || row.criticalalerts || null,
          updatedBy: row.updatedBy || row.updatedby || null,
          updatedAt: row.updatedAt || row.updatedat,
        }));
      } else if (table === 'meetingNotes') {
        data[table] = res.rows.map(row => ({
          id: row.id,
          initiativeId: row.initiativeId || row.initiativeid,
          title: row.title,
          meetingType: row.meetingType || row.meetingtype,
          meetingDate: row.meetingDate || row.meetingdate,
          location: row.location || null,
          meetingLink: row.meetingLink || row.meetinglink || null,
          facilitatorId: row.facilitatorId || row.facilitatorid,
          noteTakerId: row.noteTakerId || row.notetakerid,
          agenda: row.agenda || null,
          discussion: row.discussion || null,
          decisions: row.decisions || null,
          risks: row.risks || null,
          nextMeetingAt: row.nextMeetingAt || row.nextmeetingat || null,
          status: row.status,
          version: row.version ? Number(row.version) : 1,
          createdBy: row.createdBy || row.createdby,
          createdAt: row.createdAt || row.createdat,
          updatedAt: row.updatedAt || row.updatedat,
          deletedAt: row.deletedAt || row.deletedat || null,
        }));
      } else if (table === 'meetingNoteParticipants') {
        data[table] = res.rows.map(row => ({
          id: row.id,
          meetingNoteId: row.meetingNoteId || row.meetingnoteid,
          userId: row.userId || row.userid || null,
          email: row.email || null,
          name: row.name || null,
          role: row.role || null,
        }));
      } else if (table === 'meetingNoteActionItems') {
        data[table] = res.rows.map(row => ({
          id: row.id,
          meetingNoteId: row.meetingNoteId || row.meetingnoteid,
          description: row.description,
          ownerId: row.ownerId || row.ownerid || null,
          ownerName: row.ownerName || row.ownername || null,
          dueDate: row.dueDate || row.duedate || null,
          priority: row.priority || null,
          status: row.status,
          orderIndex: row.orderIndex !== undefined ? Number(row.orderIndex) : Number(row.orderindex || 0),
        }));
      } else if (table === 'meetingNoteEmailLog') {
        data[table] = res.rows.map(row => ({
          id: row.id,
          meetingNoteId: row.meetingNoteId || row.meetingnoteid,
          subject: row.subject,
          toEmails: row.toEmails || row.toemails || null,
          ccEmails: row.ccEmails || row.ccemails || null,
          bodySnapshot: row.bodySnapshot || row.bodysnapshot || null,
          sentBy: row.sentBy || row.sentby || null,
          sentAt: row.sentAt || row.sentat || null,
          deliveryStatus: row.deliveryStatus || row.deliverystatus || null,
          providerMessageId: row.providerMessageId || row.providermessageid || null,
          errorMessage: row.errorMessage || row.errormessage || null,
        }));
      } else if (table === 'meetingNoteHistory') {
        data[table] = res.rows.map(row => ({
          id: row.id,
          meetingNoteId: row.meetingNoteId || row.meetingnoteid,
          version: row.version !== undefined ? Number(row.version) : 1,
          field: row.field,
          oldValue: row.oldValue ?? row.oldvalue ?? null,
          newValue: row.newValue ?? row.newvalue ?? null,
          changedBy: row.changedBy || row.changedby || null,
          changedAt: row.changedAt || row.changedat || null,
        }));
      } else {
        data[table] = res.rows;
      }
    }

    const historyRes = await client.query('SELECT * FROM "changeHistory"');
    const itemsRes = await client.query('SELECT * FROM "changeHistoryItem"');

    // Normalize column names from Postgres (quoted camelCase columns are returned with exact case)
    const itemsByChangeId = itemsRes.rows.reduce((acc, row) => {
      const changeHistoryId = row.changeHistoryId || row.changehistoryid;
      if (!changeHistoryId) return acc;
      if (!acc[changeHistoryId]) acc[changeHistoryId] = [];
      acc[changeHistoryId].push({
        field: row.field,
        oldValue: row.oldValue ?? row.oldvalue,
        newValue: row.newValue ?? row.newvalue,
        changedAt: row.changedAt ?? row.changedat,
      });
      return acc;
    }, {});

    data.changeHistory = historyRes.rows
      .map((h) => ({
        id: h.id,
        initiativeId: h.initiativeId ?? h.initiativeid,
        timestamp: h.timestamp,
        changedBy: h.changedBy ?? h.changedby,
        changes: itemsByChangeId[h.id] || [],
      }))
      // Filter out entries without initiativeId to avoid breaking lookups
      .filter((h) => !!h.initiativeId);

    return data;
  } finally {
    client.release();
  }
}

/** Serialize full-store writes to avoid concurrent DELETE+INSERT races (502 / duplicate key). */
let writeQueue = Promise.resolve();

async function write(data) {
  const run = writeQueue.then(() => writeImpl(data));
  writeQueue = run.catch(() => {});
  return run;
}

async function writeImpl(data) {
  await initializeSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM "departments"');
    await client.query('DELETE FROM "users"');
    await client.query('DELETE FROM "initiatives"');
    await client.query('DELETE FROM "changeRequests"');
    await client.query('DELETE FROM "tags"');
    await client.query('DELETE FROM "initiativeTags"');
    await client.query('DELETE FROM "statusHistory"');
    await client.query('DELETE FROM "milestoneHistory"');
    await client.query('DELETE FROM "changeHistoryItem"');
    await client.query('DELETE FROM "changeHistory"');
    await client.query('DELETE FROM "comments"');
    await client.query('DELETE FROM "tasks"');
    await client.query('DELETE FROM "documents"');
    await client.query('DELETE FROM "notifications"');
    await client.query('DELETE FROM "apiClients"');
    await client.query('DELETE FROM "dwsApplications"');
    await client.query('DELETE FROM "accessRules"');
    await client.query('DELETE FROM "managementDashboard"');
    await client.query('DELETE FROM "meetingNoteParticipants"');
    await client.query('DELETE FROM "meetingNoteActionItems"');
    await client.query('DELETE FROM "meetingNoteEmailLog"');
    await client.query('DELETE FROM "meetingNoteHistory"');
    await client.query('DELETE FROM "meetingNotes"');

    const insertDept = 'INSERT INTO "departments"("id", "name") VALUES ($1, $2)';
    const seenDeptIds = new Set();
    for (const d of data.departments || []) {
      if (!d?.id || seenDeptIds.has(d.id)) continue;
      seenDeptIds.add(d.id);
      await client.query(insertDept, [d.id, d.name]);
    }

    const insertUser =
      'INSERT INTO "users"("id", "name", "email", "role", "type", "departmentId", "active", "passwordHash", "isAdmin", "emailActivated", "activationToken", "activationTokenExpiry", "resetToken", "resetTokenExpiry", "teamMemberIds") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)';
    for (const u of data.users || []) {
      // Convert teamMemberIds array to comma-separated string
      const teamMemberIds = Array.isArray(u.teamMemberIds) ? u.teamMemberIds.join(',') : (u.teamMemberIds || null);
      await client.query(insertUser, [
        u.id,
        u.name,
        u.email,
        u.role,
        u.type || null,
        u.departmentId,
        !!u.active,
        u.passwordHash || null,
        !!u.isAdmin,
        u.emailActivated !== undefined ? !!u.emailActivated : false,
        u.activationToken || null,
        u.activationTokenExpiry || null,
        u.resetToken || null,
        u.resetTokenExpiry || null,
        teamMemberIds,
      ]);
    }

    const insertInit = `INSERT INTO "initiatives"(
      "id", "type", "name", "ticket", "description", "businessImpact", "priority",
      "businessOwnerId", "businessUserIds", "departmentId", "itPicId", "itPicIds", "itPmId", "itManagerIds",
      "systemImpactedIds",
      "status", "milestone", "crMilestonePhase", "startDate", "endDate", "planStartDate", "planEndDate", "remark", "documentationLink", "createdAt", "updatedAt"
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,$13,$14,
      $15,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
    )`;
    for (const i of data.initiatives || []) {
      // Convert arrays to comma-separated strings for storage
      const businessUserIds = Array.isArray(i.businessUserIds) ? i.businessUserIds.join(',') : (i.businessUserIds || null);
      const itPicIds = Array.isArray(i.itPicIds) ? i.itPicIds.join(',') : (i.itPicIds || null);
      const itManagerIds = Array.isArray(i.itManagerIds) ? i.itManagerIds.join(',') : (i.itManagerIds || null);
      const systemImpactedIds = Array.isArray(i.systemImpactedIds) ? i.systemImpactedIds.join(',') : (i.systemImpactedIds || null);
      
      await client.query(insertInit, [
        i.id,
        i.type,
        i.name,
        i.ticket || null,
        i.description || null,
        i.businessImpact || null,
        i.priority || null,
        i.businessOwnerId || null,
        businessUserIds,
        i.departmentId || null,
        i.itPicId || null, // Keep for backward compatibility
        itPicIds,
        i.itPmId || null,
        itManagerIds,
        systemImpactedIds,
        i.status || null,
        i.milestone || null,
        i.crMilestonePhase || null,
        i.startDate || null,
        i.endDate || null,
        i.planStartDate || null,
        i.planEndDate || null,
        i.remark || null,
        i.documentationLink || null,
        i.createdAt || null,
        i.updatedAt || null,
      ]);
    }

    const insertCR = `INSERT INTO "changeRequests"(
      "initiativeId", "crSubmissionStart", "crSubmissionEnd", "developmentStart",
      "developmentEnd", "sitStart", "sitEnd", "uatStart", "uatEnd", "liveDate",
      "crSection1Start", "crSection1End", "crSection2Start", "crSection2End",
      "crSection3Start", "crSection3End", "liveStart", "liveEnd"
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18
    )`;
    for (const cr of data.changeRequests || []) {
      await client.query(insertCR, [
        cr.initiativeId,
        cr.crSubmissionStart || null,
        cr.crSubmissionEnd || null,
        cr.developmentStart || null,
        cr.developmentEnd || null,
        cr.sitStart || null,
        cr.sitEnd || null,
        cr.uatStart || null,
        cr.uatEnd || null,
        cr.liveDate || null,
        cr.crSection1Start || null,
        cr.crSection1End || null,
        cr.crSection2Start || null,
        cr.crSection2End || null,
        cr.crSection3Start || null,
        cr.crSection3End || null,
        cr.liveStart || null,
        cr.liveEnd || null,
      ]);
    }

    const insertTag = 'INSERT INTO "tags"("id", "name") VALUES ($1, $2)';
    for (const t of data.tags || []) {
      await client.query(insertTag, [t.id, t.name]);
    }

    const insertInitTag =
      'INSERT INTO "initiativeTags"("id", "initiativeId", "tagId") VALUES ($1,$2,$3)';
    for (const it of data.initiativeTags || []) {
      await client.query(insertInitTag, [it.id, it.initiativeId, it.tagId]);
    }

    const insertStatus =
      'INSERT INTO "statusHistory"("id", "initiativeId", "status", "changedAt", "changedBy") VALUES ($1,$2,$3,$4,$5)';
    for (const s of data.statusHistory || []) {
      await client.query(insertStatus, [
        s.id,
        s.initiativeId,
        s.status,
        s.changedAt,
        s.changedBy || null,
      ]);
    }

    const insertMilestone =
      'INSERT INTO "milestoneHistory"("id", "initiativeId", "milestone", "changedAt", "changedBy") VALUES ($1,$2,$3,$4,$5)';
    for (const m of data.milestoneHistory || []) {
      await client.query(insertMilestone, [
        m.id,
        m.initiativeId,
        m.milestone,
        m.changedAt,
        m.changedBy || null,
      ]);
    }

    const insertChangeHistory =
      'INSERT INTO "changeHistory"("id", "initiativeId", "timestamp", "changedBy") VALUES ($1,$2,$3,$4)';
    const insertChangeItem =
      'INSERT INTO "changeHistoryItem"("id", "changeHistoryId", "field", "oldValue", "newValue", "changedAt") VALUES ($1,$2,$3,$4,$5,$6)';
    for (const ch of data.changeHistory || []) {
      // Skip entries with null or missing initiativeId
      if (!ch.id || !ch.initiativeId) {
        continue;
      }
      await client.query(insertChangeHistory, [
        ch.id,
        ch.initiativeId,
        ch.timestamp,
        ch.changedBy || null,
      ]);
      for (const item of ch.changes || []) {
        const itemId = item.id || `${ch.id}:${item.field}:${item.changedAt}`;
        await client.query(insertChangeItem, [
          itemId,
          ch.id,
          item.field,
          item.oldValue || null,
          item.newValue || null,
          item.changedAt,
        ]);
      }
    }

    const insertComment = 'INSERT INTO "comments"("id", "initiativeId", "authorId", "body", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6)';
    for (const c of data.comments || []) {
      await client.query(insertComment, [
        c.id,
        c.initiativeId,
        c.authorId,
        c.body,
        c.createdAt,
        c.updatedAt || null,
      ]);
    }

    const insertTask = 'INSERT INTO "tasks"("id", "initiativeId", "name", "description", "startDate", "endDate", "assigneeId", "status", "milestone", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
    for (const t of data.tasks || []) {
      await client.query(insertTask, [
        t.id,
        t.initiativeId,
        t.name,
        t.description || null,
        t.startDate || null,
        t.endDate || null,
        t.assigneeId || null,
        t.status || null,
        t.milestone || null,
        t.createdAt,
        t.updatedAt || null,
      ]);
    }

    const insertDocument = 'INSERT INTO "documents"("id", "initiativeId", "fileName", "filePath", "sizeBytes", "uploadedBy", "uploadedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)';
    for (const d of data.documents || []) {
      await client.query(insertDocument, [
        d.id,
        d.initiativeId,
        d.fileName,
        d.filePath,
        d.sizeBytes,
        d.uploadedBy,
        d.uploadedAt,
      ]);
    }

    const insertNotification =
      'INSERT INTO "notifications"("id", "userId", "type", "title", "message", "initiativeId", "commentId", "read", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)';
    for (const n of data.notifications || []) {
      await client.query(insertNotification, [
        n.id,
        n.userId,
        n.type,
        n.title,
        n.message,
        n.initiativeId || null,
        n.commentId || null,
        !!n.read,
        n.createdAt,
      ]);
    }

    const insertApiClient =
      'INSERT INTO "apiClients"("id","name","clientId","clientSecretHash","scopes","active","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)';
    for (const c of data.apiClients || []) {
      await client.query(insertApiClient, [
        c.id,
        c.name,
        c.clientId,
        c.clientSecretHash,
        c.scopes || null,
        c.active !== undefined ? !!c.active : true,
        c.createdAt,
      ]);
    }

    const insertDwsApp =
      'INSERT INTO "dwsApplications"("id","systemName","productionUrl","stagingUrl","githubUrl","deploymentSteps","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
    for (const a of data.dwsApplications || []) {
      await client.query(insertDwsApp, [
        a.id,
        a.systemName,
        a.productionUrl || null,
        a.stagingUrl || null,
        a.githubUrl || null,
        a.deploymentSteps || null,
        a.createdAt,
        a.updatedAt,
      ]);
    }

    const insertAccessRule =
      'INSERT INTO "accessRules"("id","role","type","emailDomain","canViewProjectDashboard","canViewProjectList","canCreateProject","canEditAnyProject","restrictProjectVisibilityToOwnTeamOnly","restrictProjectEditToOwnTeamOnly","canViewCRDashboard","canViewCRList","canCreateCR","canEditCR","canViewMasterDwsApplication","canViewManagementDashboard") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)';
    const seenRuleIds = new Set();
    for (const r of data.accessRules || []) {
      if (!r?.id || seenRuleIds.has(r.id)) continue;
      seenRuleIds.add(r.id);
      await client.query(insertAccessRule, [
        r.id,
        r.role || null,
        r.type || null,
        r.emailDomain || null,
        !!r.canViewProjectDashboard,
        !!r.canViewProjectList,
        !!r.canCreateProject,
        !!r.canEditAnyProject,
        !!r.restrictProjectVisibilityToOwnTeamOnly,
        !!r.restrictProjectEditToOwnTeamOnly,
        !!r.canViewCRDashboard,
        !!r.canViewCRList,
        !!r.canCreateCR,
        !!r.canEditCR,
        !!r.canViewMasterDwsApplication,
        !!r.canViewManagementDashboard,
      ]);
    }

    const insertMgmtDashboard =
      'INSERT INTO "managementDashboard"("id","portfolioStatus","highlights","criticalAlerts","updatedBy","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)';
    for (const d of data.managementDashboard || []) {
      await client.query(insertMgmtDashboard, [
        d.id,
        d.portfolioStatus || null,
        d.highlights || null,
        d.criticalAlerts || null,
        d.updatedBy || null,
        d.updatedAt,
      ]);
    }

    const insertMeetingNote =
      'INSERT INTO "meetingNotes"("id", "initiativeId", "title", "meetingType", "meetingDate", "location", "meetingLink", "facilitatorId", "noteTakerId", "agenda", "discussion", "decisions", "risks", "nextMeetingAt", "status", "version", "createdBy", "createdAt", "updatedAt", "deletedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)';
    for (const note of data.meetingNotes || []) {
      await client.query(insertMeetingNote, [
        note.id,
        note.initiativeId,
        note.title,
        note.meetingType,
        note.meetingDate,
        note.location || null,
        note.meetingLink || null,
        note.facilitatorId,
        note.noteTakerId,
        note.agenda || null,
        note.discussion || null,
        note.decisions || null,
        note.risks || null,
        note.nextMeetingAt || null,
        note.status || 'Draft',
        note.version || 1,
        note.createdBy,
        note.createdAt,
        note.updatedAt || note.createdAt,
        note.deletedAt || null,
      ]);
    }

    const insertMeetingParticipant =
      'INSERT INTO "meetingNoteParticipants"("id", "meetingNoteId", "userId", "email", "name", "role") VALUES ($1,$2,$3,$4,$5,$6)';
    for (const participant of data.meetingNoteParticipants || []) {
      await client.query(insertMeetingParticipant, [
        participant.id,
        participant.meetingNoteId,
        participant.userId || null,
        participant.email || null,
        participant.name || null,
        participant.role || 'Attendee',
      ]);
    }

    const insertMeetingActionItem =
      'INSERT INTO "meetingNoteActionItems"("id", "meetingNoteId", "description", "ownerId", "ownerName", "dueDate", "priority", "status", "orderIndex") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)';
    for (const item of data.meetingNoteActionItems || []) {
      await client.query(insertMeetingActionItem, [
        item.id,
        item.meetingNoteId,
        item.description,
        item.ownerId || null,
        item.ownerName || null,
        item.dueDate || null,
        item.priority || null,
        item.status || 'Not Started',
        item.orderIndex || 0,
      ]);
    }

    const insertMeetingEmailLog =
      'INSERT INTO "meetingNoteEmailLog"("id", "meetingNoteId", "subject", "toEmails", "ccEmails", "bodySnapshot", "sentBy", "sentAt", "deliveryStatus", "providerMessageId", "errorMessage") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
    for (const log of data.meetingNoteEmailLog || []) {
      await client.query(insertMeetingEmailLog, [
        log.id,
        log.meetingNoteId,
        log.subject,
        log.toEmails || '',
        log.ccEmails || null,
        log.bodySnapshot || '',
        log.sentBy,
        log.sentAt,
        log.deliveryStatus || 'Sent',
        log.providerMessageId || null,
        log.errorMessage || null,
      ]);
    }

    const insertMeetingHistory =
      'INSERT INTO "meetingNoteHistory"("id", "meetingNoteId", "version", "field", "oldValue", "newValue", "changedBy", "changedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
    for (const history of data.meetingNoteHistory || []) {
      await client.query(insertMeetingHistory, [
        history.id,
        history.meetingNoteId,
        history.version || 1,
        history.field,
        history.oldValue || null,
        history.newValue || null,
        history.changedBy || 'Unknown',
        history.changedAt,
      ]);
    }

    await client.query('COMMIT');
    console.log(`[STORE] Write completed successfully - Users: ${(data.users || []).length}, Initiatives: ${(data.initiatives || []).length}`);
  } catch (e) {
    console.error(`[STORE] Write error:`, e.message);
    console.error(`[STORE] Error stack:`, e.stack);
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default { read, write, pool, databaseUrl };

