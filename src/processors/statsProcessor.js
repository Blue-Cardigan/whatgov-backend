export async function calculateStats(debate, memberDetails) {
  const uniqueSpeakers = new Set();
  const parties = new Map();
  let contributionCount = 0;

  // Process each contribution
  for (const item of debate.Items) {
    if (item.ItemType === 'Contribution') {
      contributionCount++;
      if (item.MemberId) {
        uniqueSpeakers.add(item.MemberId);
        const member = memberDetails.get(item.MemberId);
        if (member?.Party) {
          parties.set(member.Party, (parties.get(member.Party) || 0) + 1);
        }
      }
    }
  }

  // Convert parties Map to an object with counts
  const partyCount = Object.fromEntries(parties);

  return {
    speakerCount: uniqueSpeakers.size,
    contributionCount,
    partyCount
  };
} 