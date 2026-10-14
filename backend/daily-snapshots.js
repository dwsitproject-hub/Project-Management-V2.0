import store from './store.js';

/**
 * Daily snapshot system for tracking milestone durations
 * This captures project/CR data daily to calculate accurate milestone durations
 * based on how many days a project/CR spent in each milestone
 */

/**
 * Create a daily snapshot for all initiatives
 * This should be called once per day to capture the current state
 */
export async function createDailySnapshot() {
  const data = await store.read();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
  
  // Check if snapshot already exists for today
  if (!data.dailySnapshots) {
    data.dailySnapshots = {};
  }
  
  if (data.dailySnapshots[today]) {
    console.log(`Daily snapshot already exists for ${today}`);
    return;
  }
  
  // Create snapshot data for all initiatives
  const snapshotData = {
    date: today,
    initiatives: data.initiatives.map(initiative => ({
      id: initiative.id,
      name: initiative.name,
      type: initiative.type,
      status: initiative.status,
      milestone: initiative.milestone,
      priority: initiative.priority,
      departmentId: initiative.departmentId,
      businessOwnerId: initiative.businessOwnerId,
      itPicId: initiative.itPicId,
      createdAt: initiative.createdAt,
      startDate: initiative.startDate,
      endDate: initiative.endDate,
      updatedAt: initiative.updatedAt
    }))
  };
  
  // NOTE: dailySnapshots has no table in store.js, so store.write() cannot persist it.
  // Writing here used to DELETE + re-INSERT the entire database (every boot, every
  // 24h, and after every sheet sync) while storing nothing — pure cost, and it
  // contended with real writes. Keep the snapshot in the returned value only.
  data.dailySnapshots[today] = snapshotData;

  console.log(`Daily snapshot computed for ${today} with ${snapshotData.initiatives.length} initiatives (not persisted)`);
  return snapshotData;
}

// Sort snapshots once and index each day's initiatives by id, so per-initiative
// lookups are O(1) instead of a linear find() per day.
function indexSnapshots(dailySnapshots) {
  if (!dailySnapshots) return [];
  return Object.entries(dailySnapshots)
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, snapshot]) => [date, new Map((snapshot?.initiatives || []).map((i) => [i.id, i]))]);
}

function buildMilestoneBreakdown(initiativeId, indexedSnapshots) {
  const milestonePeriods = [];
  let currentMilestone = null;
  let milestoneStartDate = null;

  for (const [date, byId] of indexedSnapshots) {
    const initiative = byId.get(initiativeId);
    if (!initiative) continue;

    const milestone = initiative.milestone;
    if (milestone !== currentMilestone) {
      if (currentMilestone && milestoneStartDate) {
        milestonePeriods.push({
          milestone: currentMilestone,
          startDate: milestoneStartDate,
          endDate: date,
          duration: calculateDaysBetween(milestoneStartDate, date),
          status: 'Completed',
        });
      }
      currentMilestone = milestone;
      milestoneStartDate = date;
    }
  }

  if (currentMilestone && milestoneStartDate) {
    const today = new Date().toISOString().slice(0, 10);
    milestonePeriods.push({
      milestone: currentMilestone,
      startDate: milestoneStartDate,
      endDate: null,
      duration: calculateDaysBetween(milestoneStartDate, today),
      status: 'Current',
    });
  }

  return milestonePeriods;
}

/**
 * Calculate milestone duration based on daily snapshots
 * @param {string} initiativeId - The initiative ID
 * @param {string} targetMilestone - The milestone to calculate duration for
 * @returns {number} Number of days spent in the milestone
 */
export async function calculateMilestoneDuration(initiativeId, targetMilestone) {
  const data = await store.read();
  
  if (!data.dailySnapshots) {
    return 0;
  }
  
  // Get all snapshots sorted by date
  const snapshots = Object.entries(data.dailySnapshots)
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB));
  
  let duration = 0;
  let inMilestone = false;
  let milestoneStartDate = null;
  
  for (const [date, snapshot] of snapshots) {
    const initiative = snapshot.initiatives.find(i => i.id === initiativeId);
    
    if (!initiative) {
      continue;
    }
    
    const currentMilestone = initiative.milestone;
    const isInTargetMilestone = currentMilestone === targetMilestone;
    
    if (isInTargetMilestone && !inMilestone) {
      // Started the milestone
      inMilestone = true;
      milestoneStartDate = date;
    } else if (!isInTargetMilestone && inMilestone) {
      // Ended the milestone
      inMilestone = false;
      if (milestoneStartDate) {
        duration += calculateDaysBetween(milestoneStartDate, date);
      }
    }
  }
  
  // If still in milestone, count up to today
  if (inMilestone && milestoneStartDate) {
    const today = new Date().toISOString().slice(0, 10);
    duration += calculateDaysBetween(milestoneStartDate, today);
  }
  
  return duration;
}

/**
 * Get detailed milestone duration breakdown for an initiative
 * @param {string} initiativeId - The initiative ID
 * @returns {Array} Array of milestone duration objects
 */
export async function getMilestoneDurationBreakdown(initiativeId) {
  const data = await store.read();
  return buildMilestoneBreakdown(initiativeId, indexSnapshots(data.dailySnapshots));
}

/**
 * Calculate days between two dates
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {number} Number of days between dates
 */
function calculateDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = end - start;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Initialize daily snapshots if they don't exist
 * This creates a snapshot for today and can be used to bootstrap the system
 */
export async function initializeDailySnapshots() {
  const data = await store.read();
  
  if (!data.dailySnapshots || Object.keys(data.dailySnapshots).length === 0) {
    console.log('Initializing daily snapshots system...');
    await createDailySnapshot();
  }
}

/**
 * Get all milestone durations for all initiatives
 * @param {string} type - Filter by type ('Project' or 'CR')
 * @returns {Array} Array of initiative milestone durations
 */
export async function getAllMilestoneDurations(type = null) {
  // ONE store read + ONE snapshot index for all initiatives. This previously called
  // getMilestoneDurationBreakdown() per initiative, i.e. a full-database read for
  // every CR/Project on each dashboard load (hundreds of reads, seconds on RDS).
  const data = await store.read();
  let initiatives = data.initiatives || [];
  if (type) initiatives = initiatives.filter((i) => i.type === type);

  const indexed = indexSnapshots(data.dailySnapshots);
  return initiatives.map((initiative) => ({
    id: initiative.id,
    name: initiative.name,
    type: initiative.type,
    currentMilestone: initiative.milestone,
    milestoneDetails: indexed.length ? buildMilestoneBreakdown(initiative.id, indexed) : [],
  }));
}

export default {
  createDailySnapshot,
  calculateMilestoneDuration,
  getMilestoneDurationBreakdown,
  initializeDailySnapshots,
  getAllMilestoneDurations
};

