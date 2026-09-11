import express from 'express';
import store from '../store.js';
import { getAllMilestoneDurations } from '../daily-snapshots.js';

const router = express.Router();

/**
 * Calculate Go Live Rate (2M Moving Average) by priority (Projects)
 * Based on Projects with Actual End Date (endDate field), excluding CANCELLED.
 * @param {Array} projectInitiatives - Filtered Project initiatives
 * @returns {Array} Array of monthly data with 2M moving averages
 */
function calculateGoLiveRate(projectInitiatives) {
  try {
    const projectsWithEndDate = (projectInitiatives || []).filter(p => {
      if (!p || !p.endDate || p.endDate === '' || p.endDate === null) return false;
      const statusU = String(p.status || '').toUpperCase().trim();
      if (statusU === 'CANCELLED') return false;
      return true;
    });

    if (projectsWithEndDate.length === 0) return [];

    const endDates = projectsWithEndDate
      .map(p => {
        try {
          return p.endDate ? p.endDate.slice(0, 10) : null;
        } catch {
          return null;
        }
      })
      .filter(date => date && date.length === 10)
      .sort();

    if (endDates.length === 0) return [];

    const oldestDate = new Date(endDates[0]);
    if (isNaN(oldestDate.getTime())) return [];

    const today = new Date();

    // Generate monthly buckets (YYYY-MM)
    const monthlyData = {};
    const currentDate = new Date(oldestDate);
    currentDate.setDate(1);

    while (currentDate <= today) {
      const monthKey = currentDate.toISOString().slice(0, 7);
      monthlyData[monthKey] = {
        month: monthKey,
        date: new Date(currentDate),
        P0: 0,
        P1: 0,
        P2: 0,
        Total: 0,
      };
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    // Count projects by month and priority
    projectsWithEndDate.forEach(p => {
      try {
        const endDateStr = p.endDate.slice(0, 10);
        if (!endDateStr || endDateStr.length !== 10) return;
        const monthKey = endDateStr.slice(0, 7);
        if (!monthlyData[monthKey]) return;

        const priority = String(p.priority || 'P2').toUpperCase().trim();
        if (priority === 'P0') {
          monthlyData[monthKey].P0 += 1;
          monthlyData[monthKey].Total += 1;
        } else if (priority === 'P1') {
          monthlyData[monthKey].P1 += 1;
          monthlyData[monthKey].Total += 1;
        } else {
          monthlyData[monthKey].P2 += 1;
          monthlyData[monthKey].Total += 1;
        }
      } catch (e) {
        console.warn('Error processing Project for Go Live Rate:', e.message);
      }
    });

    const monthlyArray = Object.values(monthlyData).sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate 2-month moving average (prev + current)
    const result = monthlyArray.map((month, index) => {
      const movingAvg = { P0: 0, P1: 0, P2: 0, Total: 0 };
      const startIdx = Math.max(0, index - 1);
      const monthsForAvg = monthlyArray.slice(startIdx, index + 1);
      const monthCount = monthsForAvg.length;

      monthsForAvg.forEach(m => {
        movingAvg.P0 += m.P0;
        movingAvg.P1 += m.P1;
        movingAvg.P2 += m.P2;
        movingAvg.Total += m.Total;
      });

      movingAvg.P0 = monthCount > 0 ? Math.round((movingAvg.P0 / monthCount) * 10) / 10 : 0;
      movingAvg.P1 = monthCount > 0 ? Math.round((movingAvg.P1 / monthCount) * 10) / 10 : 0;
      movingAvg.P2 = monthCount > 0 ? Math.round((movingAvg.P2 / monthCount) * 10) / 10 : 0;
      movingAvg.Total = monthCount > 0 ? Math.round((movingAvg.Total / monthCount) * 10) / 10 : 0;

      return {
        month: month.month,
        monthKey: month.month,
        date: month.date.toISOString().slice(0, 10),
        monthLabel: month.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        actual: { P0: month.P0, P1: month.P1, P2: month.P2, Total: month.Total },
        movingAvg2M: movingAvg,
      };
    });

    const START_MONTH = '2025-09';
    return result.filter(r => r && typeof r.month === 'string' && r.month >= START_MONTH);
  } catch (error) {
    console.error('Error calculating Project Go Live Rate:', error);
    return [];
  }
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
  friday.setDate(monday.getDate() + 4);
  return friday.toISOString().slice(0, 10);
}

/**
 * Calculate MONTHLY open Project burndown by priority.
 *
 * A project counts as "open" in a month if, at that month's end, it had been
 * created but was not yet completed:
 *   - created (createdAt / startDate / planStartDate) on or before month-end, AND
 *   - not completed by month-end. Completion is driven by the Actual End Date:
 *       * has an end date -> open only in months BEFORE that date (it closed then);
 *       * no end date     -> open unless the project is already in a terminal
 *                            status (Live / Done / Cancelled) with no date to place it.
 *
 * So projects still In Progress / Not Started (no end date, non-terminal) stay
 * open from their creation month through the current month, while completed
 * projects drop out in the month they closed — a true burndown. The current
 * month's Total therefore equals the count of projects that are open right now
 * (Status = In Progress + Not Started, i.e. not Live/Done/Cancelled).
 *
 * @param {Array} projectInitiatives - Filtered Project initiatives
 * @returns {Array} Array of monthly burndown data
 */
function calculateOpenBurndown(projectInitiatives) {
  if (!projectInitiatives || projectInitiatives.length === 0) {
    return [];
  }

  // Local YYYY-MM-DD (avoid UTC day-shifts from toISOString()).
  const ymd = (dt) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  // 12-month window ending with the current month.
  const today = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0); // last day of month
    months.push({
      monthStart: ymd(start),
      monthEnd: ymd(end),
      label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    });
  }

  const TERMINAL = new Set(['LIVE', 'DONE', 'CANCELLED', 'CANCEL']);

  const isOpenAt = (p, monthEndStr) => {
    const createdRaw = p.createdAt || p.startDate || p.planStartDate || '';
    if (!createdRaw) return false;
    if (String(createdRaw).slice(0, 10) > monthEndStr) return false; // not created yet

    // Status is authoritative for "open": a currently non-terminal project is open
    // from its creation month onward (even with a stale end date). Only terminal
    // projects use their Actual End Date to place WHEN they closed.
    const isTerminal = TERMINAL.has(String(p.status || '').toUpperCase().trim());
    if (!isTerminal) return true;
    const endRaw = p.endDate && String(p.endDate).trim() !== '' ? p.endDate : null;
    return endRaw ? String(endRaw).slice(0, 10) > monthEndStr : false;
  };

  return months.map((m) => {
    const counts = { P0: 0, P1: 0, P2: 0, Total: 0 };
    for (const p of projectInitiatives) {
      if (!isOpenAt(p, m.monthEnd)) continue;
      const priority = String(p.priority || 'P2').toUpperCase().trim();
      if (priority === 'P0') counts.P0 += 1;
      else if (priority === 'P1') counts.P1 += 1;
      else counts.P2 += 1;
    }
    counts.Total = counts.P0 + counts.P1 + counts.P2;

    return {
      monthStart: m.monthStart,
      monthEnd: m.monthEnd,
      label: m.label,
      weekLabel: m.label, // backward-compat: existing chart reads weekLabel for x-axis
      ...counts,
    };
  });
}

/**
 * Calculate monthly open Projects (status != Live and != Cancelled) at end of each month
 * @param {Array} projectInitiatives - Filtered Project initiatives
 * @returns {Array} Array of monthly open Project data
 */
function calculateMonthlyOpenProjects(projectInitiatives) {
  if (!projectInitiatives || projectInitiatives.length === 0) {
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

    const openProjects = projectInitiatives.filter((p) => {
      try {
        const status = (p.status || '').toUpperCase().trim();
        if (status === 'LIVE' || status === 'CANCELLED') return false;

        const createdAt = p.createdAt || p.startDate;
        if (!createdAt) return false;
        const createdDateStr = String(createdAt).slice(0, 10);
        if (createdDateStr > monthEndStr) return false;

        if (p.endDate && p.endDate !== '' && p.endDate !== null) {
          const endDateStr = String(p.endDate).slice(0, 10);
          if (endDateStr <= monthEndStr) return false;
        }

        return true;
      } catch (err) {
        console.error('Error calculating open Projects for month:', monthEndStr, err);
        return false;
      }
    }).length;

    months.push({
      year,
      month: month + 1,
      monthKey,
      monthLabel,
      monthEnd: monthEndStr,
      openProjects,
    });
  }

  return months;
}

router.get('/', async (req, res) => {
  const { departmentId, itPmId, teamMemberId } = req.query;
  const data = await store.read();
  const total = data.initiatives.length;
  const crs = data.initiatives.filter(i => i.type === 'CR').length;
  
  // Only count Project-type initiatives for distributions
  let projectInitiatives = data.initiatives.filter(i => i.type === 'Project');

  const normStatus = (s) => String(s || '').toUpperCase().trim();
  const normPriority = (p) => String(p || '').toUpperCase().trim();
  const normMilestone = (m) => String(m || '').trim();
  
  // Apply filters
  if (departmentId) {
    projectInitiatives = projectInitiatives.filter(i => i.departmentId === departmentId);
  }
  if (itPmId) {
    projectInitiatives = projectInitiatives.filter(i => i.itPmId === itPmId);
  }
  if (teamMemberId) {
    // Filter initiatives where the team member is involved in any role:
    // - IT PIC (itPicId or in itPicIds)
    // - IT PM (itPmId)
    // - Business Owner (businessOwnerId)
    // - Business User (in businessUserIds)
    projectInitiatives = projectInitiatives.filter(i => {
      // Check IT PIC
      if (i.itPicId === teamMemberId) return true;
      if (i.itPicIds && i.itPicIds.split(',').map(id => id.trim()).includes(teamMemberId)) return true;
      
      // Check IT PM
      if (i.itPmId === teamMemberId) return true;
      
      // Check Business Owner
      if (i.businessOwnerId === teamMemberId) return true;
      
      // Check Business Users
      if (i.businessUserIds && i.businessUserIds.split(',').map(id => id.trim()).includes(teamMemberId)) return true;
      
      return false;
    });
  }
  
  // Count projects after filtering
  const projects = projectInitiatives.length;
  const countBy = (key, normFn = (v) => v) => {
    const acc = projectInitiatives.reduce((m, i) => {
      const raw = i[key];
      const k = normFn(raw);
      if (!k) return m;
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    return Object.entries(acc).map(([k, v]) => ({ [key]: k, c: v }));
  };
  const byStatus = countBy('status', normStatus);
  const byPriority = countBy('priority', normPriority);
  const byDepartment = countBy('departmentId');
  
  // Milestone distribution - only count projects with non-blank milestones
  const projectsWithMilestone = projectInitiatives.filter(i => normMilestone(i.milestone) !== '');
  const byMilestone = Object.entries(projectsWithMilestone.reduce((acc, i) => {
    const k = normMilestone(i.milestone);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {})).map(([k, v]) => ({ milestone: k, c: v }));

  // Breakdowns (for dashboard charts)
  const byStatusBreakdown = {};
  const byPriorityBreakdown = {};
  const byMilestoneBreakdown = {};

  projectInitiatives.forEach(i => {
    const status = normStatus(i.status);
    const priority = normPriority(i.priority) || 'P2';
    const milestone = normMilestone(i.milestone);

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
  const liveYTD = projectInitiatives.filter(i => (i.status && i.status.toUpperCase() === 'LIVE') && (i.updatedAt||'').startsWith(String(year))).length;
  // Count all Live projects (not just YTD) - case insensitive
  const liveCount = projectInitiatives.filter(i => i.status && i.status.toUpperCase() === 'LIVE').length;

  // Calculate Go Live Rate (2M Moving Average) by priority (Projects)
  const goLiveRateData = calculateGoLiveRate(projectInitiatives);
  // Calculate weekly open Project burndown by priority
  const openBurndownData = calculateOpenBurndown(projectInitiatives);
  // Calculate monthly open Projects for forecasting
  const monthlyOpenProjects = calculateMonthlyOpenProjects(projectInitiatives);
  
  // Calculate aging metrics (Projects only) - use filtered list
  const now = new Date();
  const projectAging = projectInitiatives.map(i => {
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
  
  const avgAgeSinceCreated = projectAging.length > 0 ? 
    Math.round(projectAging.reduce((sum, m) => sum + m.daysSinceCreated, 0) / projectAging.length) : 0;
  
  // Calculate detailed milestone durations using daily snapshots (Projects only)
  // Get all milestone durations and then filter by the filtered project IDs
  const allMilestoneDurations = await getAllMilestoneDurations('Project');
  const filteredProjectIds = new Set(projectInitiatives.map(p => p.id));
  const milestoneDurations = allMilestoneDurations.filter(m => filteredProjectIds.has(m.id));
  
  // Generate Project Insights
  const insights = {
    totalProjects: projects,
    activeProjects: projectInitiatives.filter(i => i.status && i.status.toUpperCase() !== 'NOT STARTED').length,
    atRiskCount: projectInitiatives.filter(i => i.status && i.status.toUpperCase() === 'AT RISK').length,
    delayedCount: projectInitiatives.filter(i => i.status && i.status.toUpperCase() === 'DELAYED').length,
    liveCount: projectInitiatives.filter(i => i.status && i.status.toUpperCase() === 'LIVE').length,
    avgAgeDays: avgAgeSinceCreated,
    oldestProject: projectAging.length > 0 ? projectAging.reduce((max, p) => p.daysSinceCreated > max.daysSinceCreated ? p : max) : null,
    newestProject: projectAging.length > 0 ? projectAging.reduce((min, p) => p.daysSinceCreated < min.daysSinceCreated ? p : min) : null,
    mostCommonMilestone: byMilestone.length > 0 ? byMilestone.reduce((max, m) => m.c > max.c ? m : max) : null,
    highPriorityCount: projectInitiatives.filter(i => i.priority === 'P0').length,
    recommendations: []
  };
  
  // Add AI-powered recommendations
  if (insights.atRiskCount > 0) {
    insights.recommendations.push(`⚠️ ${insights.atRiskCount} project${insights.atRiskCount > 1 ? 's are' : ' is'} at risk. Review and mitigate risks immediately.`);
  }
  if (insights.delayedCount > 0) {
    insights.recommendations.push(`🚨 ${insights.delayedCount} project${insights.delayedCount > 1 ? 's are' : ' is'} delayed. Urgent action required.`);
  }
  if (insights.highPriorityCount > 0 && insights.atRiskCount + insights.delayedCount > 0) {
    insights.recommendations.push(`🎯 Focus on ${insights.highPriorityCount} P0 project${insights.highPriorityCount > 1 ? 's' : ''} to minimize business impact.`);
  }
  if (insights.avgAgeDays > 90) {
    insights.recommendations.push(`⏰ Average project age is ${insights.avgAgeDays} days. Consider accelerating delivery cycles.`);
  }
  if (insights.liveCount > 0) {
    insights.recommendations.push(`✅ ${insights.liveCount} project${insights.liveCount > 1 ? 's are' : ' is'} live. Great progress!`);
  }
  if (insights.recommendations.length === 0) {
    insights.recommendations.push(`✨ All projects are on track. Keep up the good work!`);
  }
  
  res.json({ 
    projects, byStatus, byPriority, byDepartment, byMilestone, liveYTD, liveCount,
    avgAgeSinceCreated,
    projectAging,
    milestoneDurations,
    insights,
    byStatusBreakdown,
    byPriorityBreakdown,
    byMilestoneBreakdown,
    goLiveRateData,
    openBurndownData,
    monthlyOpenProjects
  });
});

export default router;

