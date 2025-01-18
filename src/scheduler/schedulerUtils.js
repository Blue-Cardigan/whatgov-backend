export function calculateNextRunDate(repeatOn) {
  const now = new Date();
  const nextDate = new Date(now);
  
  if (repeatOn.frequency === 'weekly') {
    // Convert from ISO day (1-7, Monday-Sunday) to JS day (0-6, Sunday-Saturday)
    const targetDay = repeatOn.dayOfWeek === 7 ? 0 : repeatOn.dayOfWeek;
    const currentDay = nextDate.getDay();
    
    // Calculate days until next occurrence
    let daysToAdd = (targetDay - currentDay + 7) % 7;
    if (daysToAdd === 0) {
      // If it's the same day but past 7am, schedule for next week
      if (nextDate.getHours() >= 7) {
        daysToAdd = 7;
      }
    }
    
    // Add the calculated days
    nextDate.setDate(nextDate.getDate() + daysToAdd);
    // Set to 7am
    nextDate.setHours(7, 0, 0, 0);
  }
  
  return nextDate;
}