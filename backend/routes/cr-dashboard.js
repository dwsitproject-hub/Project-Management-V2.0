import express from 'express';
import store from '../store.js';
import { getAllMilestoneDurations } from '../daily-snapshots.js';
import {
  normalizeCrMilestonePhase,
  CR_MILESTONE_LIVE_WARRANTY,
  CR_MILESTONE_FULLY_LIVE,
} from '../crTaskTemplates.js';

const CR_OPEN_STATUSES = new Set(['NOT STARTED', 'ON TRACK', 'AT RISK', 'DELAYED']);

const router = express.Router();

/**
 * Calculate weekly trend data for CRs
 * @param {string} type - Filter by type ('Project' or 'CR')
 * @param {Array} filteredCRs - Filtered CRs to use for calculation
 * @returns {Array} Array of weekly trend data
 */
async function calculateWeeklyTrend(type = 'CR', filteredCRs = null) {
  const data = await store.read();
  
  // Use filtered CRs if provided, otherwise use all CRs
  const allCRs = filteredCRs || data.initiatives.filter(i => i.type === type);
  
  // Generate the last 12 consecutive weeks from today going backwards
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const currentWeekKey = getWeekKey(todayStr);
  
  // Build array of 12 consecutive week keys (current week + 11 previous weeks)
  const weekKeys = [];
  for (let i = 0; i < 12; i++) {
    const weekDate = new Date(currentWeekKey);
    weekDate.setDate(weekDate.getDate() - (i * 7)); // Go back i weeks
    weekKeys.push(getWeekKey(weekDate.toISOString().slice(0, 10)));
  }
  
  // Reverse to get chronological order (oldest to newest)
  weekKeys.reverse();
  
  // Calculate metrics for each of the 12 consecutive weeks
  const weeklyData = weekKeys.map((weekKey) => {
    const weekStartStr = weekKey;
    const weekEndStr = getWeekEnd(weekKey);
    
    // 1. NEW: Count CRs created in this specific week
    const newCRs = allCRs.filter(cr => {
      if (!cr.createdAt || cr.createdAt === '' || cr.createdAt === null) return false;
      const createdDateStr = cr.createdAt.slice(0, 10);
      return createdDateStr >= weekStartStr && createdDateStr <= weekEndStr;
    }).length;
    
    // 2. LIVE: Count CRs that went LIVE in this specific week (based on endDate)
    const liveCRs = allCRs.filter(cr => {
      if (!cr.status || cr.status.toUpperCase() !== 'LIVE') return false;
      if (!cr.endDate || cr.endDate === '' || cr.endDate === null) return false;
      const endDateStr = cr.endDate.slice(0, 10);
      return endDateStr >= weekStartStr && endDateStr <= weekEndStr;
    }).length;
    
    // 3. TOTAL: Count all CRs that existed by the end of this week (cumulative)
    // This means CRs created on or before the end of this week
    const totalCRs = allCRs.filter(cr => {
      if (!cr.createdAt || cr.createdAt === '' || cr.createdAt === null) return false;
      const createdDateStr = cr.createdAt.slice(0, 10);
      return createdDateStr <= weekEndStr;
    }).length;
    
    // Format week label (Monday - Friday) with year
    const mondayDate = new Date(weekKey);
    const fridayDate = new Date(weekEndStr);
    
    const weekLabel = `${mondayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${fridayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    
    return {
      weekStart: weekKey,
      weekEnd: weekEndStr,
      weekLabel,
      newCRs,
      liveCRs,
      totalCRs
    };
  });
  
  // Return all 12 consecutive weeks
  return weeklyData;
}

/**
 * Get week key (Monday date) for a given date
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {string} Monday date of the week
 */
function getWeekKey(date) {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // If Sunday, go back 6 days, otherwise go back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

/**
 * Get week end date (Friday) for a given week key
 * @param {string} weekKey - Monday date in YYYY-MM-DD format
 * @returns {string} Friday date of the week
 */
function getWeekEnd(weekKey) {
  const monday = new Date(weekKey);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4); // Friday is 4 days after Monday
  return friday.toISOString().slice(0, 10);
}

// A CR counts as "open" at a cutoff date if it was created by then and had not
// yet closed. Status is authoritative for "open": a CR that is currently in a
// non-terminal status (not Live/Done/Cancelled) is open from its creation date
// onward — even if it carries a stale end date. Only currently-terminal CRs use
// their Actual End Date to place WHEN they closed (open only in periods before
// that date; a terminal CR with no end date can't be placed, so it's treated as
// closed). This is a TRUE burndown: a CR that later went live still counts in
// the weeks it was open and drops out from the week it closed — unlike the old
// logic, which excluded every currently-Live/Cancelled CR from all weeks.
const CR_TERMINAL = new Set(['LIVE', 'DONE', 'CANCELLED', 'CANCEL']);
function isCrOpenAt(cr, cutoffStr) {
  const createdRaw = cr.createdAt || cr.startDate || cr.planStartDate || '';
  if (!createdRaw) return false;
  if (String(createdRaw).slice(0, 10) > cutoffStr) return false; // not created yet
  const isTerminal = CR_TERMINAL.has(String(cr.status || '').toUpperCase().trim());
  if (!isTerminal) return true; // currently open -> open since it was created
  // Terminal now: closed on its Actual End Date (open only before it); undated -> closed.
  const endRaw = cr.endDate && String(cr.endDate).trim() !== '' ? cr.endDate : null;
  return endRaw ? String(endRaw).slice(0, 10) > cutoffStr : false;
}

/**
 * Calculate weekly open CR burndown by priority.
 * Open = created by week-end and not yet closed by week-end (see isCrOpenAt).
 * @param {Array} crInitiatives - Filtered CR initiatives
 * @returns {Array} Array of weekly burndown data
 */
function calculateOpenBurndown(crInitiatives) {
  if (!crInitiatives || crInitiatives.length === 0) {
    return [];
  }

  // Reuse the same 12-week window as calculateWeeklyTrend
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const currentWeekKey = getWeekKey(todayStr);

  const weekKeys = [];
  for (let i = 0; i < 12; i++) {
    const weekDate = new Date(currentWeekKey);
    weekDate.setDate(weekDate.getDate() - i * 7);
    weekKeys.push(getWeekKey(weekDate.toISOString().slice(0, 10)));
  }
  weekKeys.reverse();

  const weeklyData = weekKeys.map((weekKey) => {
    const weekEndStr = getWeekEnd(weekKey);

    const counts = { P0: 0, P1: 0, P2: 0, Total: 0 };
    for (const cr of crInitiatives) {
      if (!isCrOpenAt(cr, weekEndStr)) continue;
      const priority = String(cr.priority || 'P2').toUpperCase().trim();
      if (priority === 'P0') counts.P0 += 1;
      else if (priority === 'P1') counts.P1 += 1;
      else counts.P2 += 1;
    }
    counts.Total = counts.P0 + counts.P1 + counts.P2;

    const mondayDate = new Date(weekKey);
    const fridayDate = new Date(weekEndStr);
    const weekLabel = `${mondayDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })} - ${fridayDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;

    return {
      weekStart: weekKey,
      weekEnd: weekEndStr,
      weekLabel,
      ...counts,
    };
  });

  return weeklyData;
}

/**
 * Same "went live" definition as CR Weekly Trend: status LIVE + Actual End Date.
 */
function isCrWentLive(cr) {
  if (!cr) return false;
  const status = (cr.status || '').toUpperCase();
  if (status !== 'LIVE') return false;
  if (!cr.endDate || cr.endDate === '' || cr.endDate === null) return false;
  return true;
}

/**
 * Calculate Go Live Rate (2M Moving Average) by priority.
 * Counts CRs that went live (LIVE + endDate), grouped by endDate month.
 * @param {Array} crInitiatives - Filtered CR initiatives
 * @returns {Array} Array of monthly data with 2M moving averages
 */
function calculateGoLiveRate(crInitiatives) {
  try {
    const crsWentLive = crInitiatives.filter(isCrWentLive);

    if (crsWentLive.length === 0) {
      return [];
    }

    // Get date range (from oldest endDate to today)
    const endDates = crsWentLive
      .map(cr => {
        try {
          return cr.endDate ? cr.endDate.slice(0, 10) : null;
        } catch (e) {
          return null;
        }
      })
      .filter(date => date && date.length === 10)
      .sort();
    
    if (endDates.length === 0) {
      return [];
    }
    
    const oldestDate = new Date(endDates[0]);
    if (isNaN(oldestDate.getTime())) {
      return [];
    }
    
    const today = new Date();
    
    // Generate monthly buckets (YYYY-MM format)
    const monthlyData = {};
    const currentDate = new Date(oldestDate);
    currentDate.setDate(1); // Start of month
    
    while (currentDate <= today) {
      const monthKey = currentDate.toISOString().slice(0, 7); // YYYY-MM
      monthlyData[monthKey] = {
        month: monthKey,
        date: new Date(currentDate),
        P0: 0,
        P1: 0,
        P2: 0,
        Total: 0
      };
      
      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    // Count CRs that went live by endDate month and priority
    crsWentLive.forEach(cr => {
      try {
        if (!cr || !cr.endDate) return;
        const endDateStr = cr.endDate.slice(0, 10);
        if (!endDateStr || endDateStr.length !== 10) return;
        
        const monthKey = endDateStr.slice(0, 7); // YYYY-MM
        
        if (monthlyData[monthKey]) {
          const priority = (cr.priority || 'P2').toUpperCase();
          
          if (priority === 'P0') {
            monthlyData[monthKey].P0++;
            monthlyData[monthKey].Total++;
          } else if (priority === 'P1') {
            monthlyData[monthKey].P1++;
            monthlyData[monthKey].Total++;
          } else if (priority === 'P2') {
            monthlyData[monthKey].P2++;
            monthlyData[monthKey].Total++;
          }
        }
      } catch (e) {
        // Skip invalid entries
        console.warn('Error processing CR for Go Live Rate:', e.message);
      }
    });

    // Convert to array and sort by date
    const monthlyArray = Object.values(monthlyData).sort((a, b) => 
      a.date.getTime() - b.date.getTime()
    );

    // Calculate 2-month moving average
    const result = monthlyArray.map((month, index) => {
      const movingAvg = {
        P0: 0,
        P1: 0,
        P2: 0,
        Total: 0
      };

      // Get previous 1 month + current month (2 months total)
      const startIdx = Math.max(0, index - 1);
      const monthsForAvg = monthlyArray.slice(startIdx, index + 1);
      const monthCount = monthsForAvg.length;

      monthsForAvg.forEach(m => {
        movingAvg.P0 += m.P0;
        movingAvg.P1 += m.P1;
        movingAvg.P2 += m.P2;
        movingAvg.Total += m.Total;
      });

      // Calculate average
      movingAvg.P0 = monthCount > 0 ? Math.round((movingAvg.P0 / monthCount) * 10) / 10 : 0;
      movingAvg.P1 = monthCount > 0 ? Math.round((movingAvg.P1 / monthCount) * 10) / 10 : 0;
      movingAvg.P2 = monthCount > 0 ? Math.round((movingAvg.P2 / monthCount) * 10) / 10 : 0;
      movingAvg.Total = monthCount > 0 ? Math.round((movingAvg.Total / monthCount) * 10) / 10 : 0;

      return {
        month: month.month,
        monthKey: month.month, // Add monthKey for easier matching
        date: month.date.toISOString().slice(0, 10),
        monthLabel: month.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        actual: {
          P0: month.P0,
          P1: month.P1,
          P2: month.P2,
          Total: month.Total
        },
        movingAvg2M: movingAvg
      };
    });

    // Display window: start x-axis from Sep 2025 onwards (keep earlier months for MA calc above)
    const START_MONTH = '2025-09'; // YYYY-MM
    return result.filter(r => r && typeof r.month === 'string' && r.month >= START_MONTH);
  } catch (error) {
    console.error('Error calculating Go Live Rate:', error);
    return [];
  }
}

router.get('/', async (req, res) => {
  const { departmentId, itManagerId, systemImpactedId } = req.query;
  const data = await store.read();
  const total = data.initiatives.length;
  const projects = data.initiatives.filter(i => i.type === 'Project').length;
  
  // Only count CR-type initiatives for distributions
  let crInitiatives = data.initiatives.filter(i => i.type === 'CR');
  
  const normStatus = (s) => String(s || '').toUpperCase().trim();
  const normPriority = (p) => String(p || '').toUpperCase().trim();
  const normMilestone = (m) => normalizeCrMilestonePhase(String(m || '').trim() || '');

  const systemImpactedValues = String(systemImpactedId || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Apply filters
  if (departmentId) {
    crInitiatives = crInitiatives.filter(i => i.departmentId === departmentId);
  }
  if (itManagerId) {
    // itManagerIds is a comma-separated string, so check if itManagerId is included
    crInitiatives = crInitiatives.filter(i => {
      const managerIds = (i.itManagerIds || '').split(',').map(id => id.trim()).filter(id => id);
      return managerIds.includes(itManagerId);
    });
  }
  if (systemImpactedValues.length > 0) {
    crInitiatives = crInitiatives.filter((i) => {
      const raw = i.systemImpactedIds || '';
      const ids = Array.isArray(raw)
        ? raw
        : String(raw).split(',').map((id) => id.trim()).filter(Boolean);
      return systemImpactedValues.some((sel) => ids.includes(sel));
    });
  }
  
  // Count CRs after filtering
  const crs = crInitiatives.length;
  const countBy = (key, normFn = (v) => v) => {
    const acc = crInitiatives.reduce((m, i) => {
      const raw = i[key];
      const k = normFn(raw);
      if (!k) return m;
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    return Object.entries(acc).map(([k, v]) => ({ [key]: k, c: v }));
  };
  // Status should be case-insensitive (normalize to avoid duplicates like "LIVE" vs "Live")
  const byStatus = countBy('status', normStatus);
  const byPriority = countBy('priority', normPriority);
  const byDepartment = countBy('departmentId');
  
  // Milestone distribution - only count CRs with non-blank milestones
  const crsWithMilestone = crInitiatives.filter(i => normMilestone(i.milestone) !== '');
  const byMilestone = Object.entries(crsWithMilestone.reduce((acc, i) => {
    const k = normMilestone(i.milestone);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {})).map(([k, v]) => ({ milestone: k, c: v }));
  
  // Breakdowns (for dashboard charts) - normalized to match aggregated keys
  const byStatusBreakdown = {};
  const byPriorityBreakdown = {};
  const byMilestoneBreakdown = {};

  crInitiatives.forEach(cr => {
    const status = normStatus(cr.status);
    const priority = normPriority(cr.priority) || 'P2';
    const milestone = normMilestone(cr.milestone);

    if (status) {
      if (!byStatusBreakdown[status]) byStatusBreakdown[status] = { P0: 0, P1: 0, P2: 0 };
      if (byStatusBreakdown[status][priority] !== undefined) byStatusBreakdown[status][priority] += 1;
    }

    if (priority) {
      if (!byPriorityBreakdown[priority]) byPriorityBreakdown[priority] = {};
      if (status) byPriorityBreakdown[priority][status] = (byPriorityBreakdown[priority][status] || 0) + 1;
    }

    if (milestone) {
      if (!byMilestoneBreakdown[milestone]) byMilestoneBreakdown[milestone] = { P0: 0, P1: 0, P2: 0 };
      if (byMilestoneBreakdown[milestone][priority] !== undefined) byMilestoneBreakdown[milestone][priority] += 1;
    }
  });
  
  const year = new Date().getFullYear();
  const liveYTD = crInitiatives.filter(i => (i.status && i.status.toUpperCase() === 'LIVE') && (i.updatedAt||'').startsWith(String(year))).length;
  const liveCRs = crInitiatives.filter((i) => normStatus(i.status) === 'LIVE');
  const liveCount = liveCRs.length;
  const liveWarrantyCount = liveCRs.filter(
    (i) => normMilestone(i.milestone) === CR_MILESTONE_LIVE_WARRANTY
  ).length;
  const liveFullyLiveCount = liveCRs.filter(
    (i) => normMilestone(i.milestone) === CR_MILESTONE_FULLY_LIVE
  ).length;
  const openCount = crInitiatives.filter((i) => CR_OPEN_STATUSES.has(normStatus(i.status))).length;
  
  // Calculate aging metrics (CRs only) - use filtered list
  const now = new Date();
  const crAging = crInitiatives.map(i => {
    const createDate = new Date(i.createdAt || i.startDate);
    const daysSinceCreated = Math.floor((now - createDate) / (1000 * 60 * 60 * 24));
    return { 
      id: i.id, 
      name: i.name, 
      daysSinceCreated, 
      status: i.status, 
      milestone: i.milestone,
      departmentId: i.departmentId
    };
  });
  
  const avgAgeSinceCreated = crAging.length > 0 ? 
    Math.round(crAging.reduce((sum, m) => sum + m.daysSinceCreated, 0) / crAging.length) : 0;
  
  // Calculate detailed milestone durations using daily snapshots (CRs only)
  // Get all milestone durations and then filter by the filtered CR IDs
  const allMilestoneDurations = await getAllMilestoneDurations('CR');
  const filteredCRIds = new Set(crInitiatives.map(c => c.id));
  const milestoneDurations = allMilestoneDurations.filter(m => filteredCRIds.has(m.id));
  
  // Calculate weekly trend data for CRs (using filtered CRs)
  const weeklyTrendData = await calculateWeeklyTrend('CR', crInitiatives);

  // Calculate Go Live Rate (2M Moving Average) by priority
  const goLiveRateData = calculateGoLiveRate(crInitiatives);

  // Calculate weekly open CR burndown by priority
  const openBurndownData = calculateOpenBurndown(crInitiatives);

  // Calculate week boundaries (Monday to Sunday)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // If Sunday, go back 6 days, otherwise go back to Monday
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6); // Sunday
  weekEnd.setHours(23, 59, 59, 999);
  
  // Count CRs created this week (only those with actual Create Date from Excel)
  const crsCreatedThisWeek = crInitiatives.filter(i => {
    // Exclude CRs without a real Create Date (null, undefined, or empty string)
    if (!i.createdAt || i.createdAt === '' || i.createdAt === null) return false;
    
    // Parse the date string (YYYY-MM-DD) and compare just the date part
    const createdDateStr = i.createdAt.split('T')[0]; // Handle both "2025-10-09" and "2025-10-09T12:00:00Z"
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    return createdDateStr >= weekStartStr && createdDateStr <= weekEndStr;
  });
  
  // Generate CR Insights
  const insights = {
    totalCRs: crs,
    activeCRs: crInitiatives.filter(i => i.status && i.status.toUpperCase() !== 'NOT STARTED').length,
    atRiskCount: crInitiatives.filter(i => i.status && i.status.toUpperCase() === 'AT RISK').length,
    delayedCount: crInitiatives.filter(i => i.status && i.status.toUpperCase() === 'DELAYED').length,
    liveCount: crInitiatives.filter(i => i.status && i.status.toUpperCase() === 'LIVE').length,
    avgAgeDays: avgAgeSinceCreated,
    oldestCR: crAging.length > 0 ? crAging.reduce((max, p) => p.daysSinceCreated > max.daysSinceCreated ? p : max) : null,
    newestCR: crAging.length > 0 ? crAging.reduce((min, p) => p.daysSinceCreated < min.daysSinceCreated ? p : min) : null,
    mostCommonMilestone: byMilestone.length > 0 ? byMilestone.reduce((max, m) => m.c > max.c ? m : max) : null,
    highPriorityCount: crInitiatives.filter(i => i.priority === 'P0').length,
    newThisWeekCount: crsCreatedThisWeek.length,
    newThisWeekCRs: crsCreatedThisWeek.map(i => ({ id: i.id, name: i.name, createdAt: i.createdAt })),
    weekStart: weekStart.toISOString().split('T')[0],
    weekEnd: weekEnd.toISOString().split('T')[0],
    recommendations: []
  };
  
  // Add AI-powered recommendations for CRs
  if (insights.atRiskCount > 0) {
    insights.recommendations.push(`⚠️ ${insights.atRiskCount} CR${insights.atRiskCount > 1 ? 's are' : ' is'} at risk. Review and mitigate risks immediately.`);
  }
  if (insights.delayedCount > 0) {
    insights.recommendations.push(`🚨 ${insights.delayedCount} CR${insights.delayedCount > 1 ? 's are' : ' is'} delayed. Urgent action required.`);
  }
  if (insights.highPriorityCount > 0 && insights.atRiskCount + insights.delayedCount > 0) {
    insights.recommendations.push(`🎯 Focus on ${insights.highPriorityCount} P0 CR${insights.highPriorityCount > 1 ? 's' : ''} to minimize business impact.`);
  }
  if (insights.avgAgeDays > 60) {
    insights.recommendations.push(`⏰ Average CR age is ${insights.avgAgeDays} days. Consider accelerating development cycles.`);
  }
  if (insights.liveCount > 0) {
    insights.recommendations.push(`✅ ${insights.liveCount} CR${insights.liveCount > 1 ? 's are' : ' is'} live. Great progress!`);
  }
  if (insights.recommendations.length === 0) {
    insights.recommendations.push(`✨ All CRs are on track. Keep up the good work!`);
  }
  
  // Calculate monthly open CRs for forecasting
  const monthlyOpenCRs = calculateMonthlyOpenCRs(crInitiatives);

  res.json({ 
    crs, byStatus, byPriority, byDepartment, byMilestone, liveYTD, liveCount,
    liveWarrantyCount, liveFullyLiveCount, openCount,
    byStatusBreakdown,
    byPriorityBreakdown,
    byMilestoneBreakdown,
    avgAgeSinceCreated,
    crAging,
    milestoneDurations,
    weeklyTrendData,
    goLiveRateData,
    openBurndownData,
    monthlyOpenCRs,
    insights
  });
});

/**
 * Calculate monthly open CRs (status != Live and != Cancelled) at end of each month
 * @param {Array} crInitiatives - Filtered CR initiatives
 * @returns {Array} Array of monthly open CR data
 */
function calculateMonthlyOpenCRs(crInitiatives) {
  if (!crInitiatives || crInitiatives.length === 0) {
    return [];
  }

  // Generate months from Dec 2025 to current month
  const startDate = new Date('2025-12-01');
  const currentDate = new Date();
  const months = [];
  
  for (let d = new Date(startDate); d <= currentDate; d.setMonth(d.getMonth() + 1)) {
    const year = d.getFullYear();
    const month = d.getMonth();
    const monthEnd = new Date(year, month + 1, 0); // Last day of month
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const monthEndStr = monthEnd.toISOString().slice(0, 10);
    
    // Count open CRs at end of month — same open definition as calculateOpenBurndown.
    const openCRs = crInitiatives.filter((cr) => isCrOpenAt(cr, monthEndStr)).length;
    
    months.push({
      year,
      month: month + 1,
      monthKey,
      monthLabel,
      monthEnd: monthEndStr,
      openCRs
    });
  }
  
  return months;
}

export {
  calculateWeeklyTrend,
  calculateGoLiveRate,
  calculateOpenBurndown,
  calculateMonthlyOpenCRs,
  getWeekKey,
  getWeekEnd,
};
export default router;

