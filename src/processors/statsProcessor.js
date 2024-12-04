export async function calculateStats(debate, memberDetails) {
  const uniqueSpeakers = new Set();
  const partyMembers = new Map(); // Track unique members per party
  let contributionCount = 0;

  // Process each contribution
  for (const item of debate.Items) {
    if (item.ItemType === 'Contribution' && item.MemberId) {
      contributionCount++;
      uniqueSpeakers.add(item.MemberId);
      
      const member = memberDetails.get(item.MemberId);
      if (member?.Party) {
        // For each party, maintain a Set of unique member IDs
        if (!partyMembers.has(member.Party)) {
          partyMembers.set(member.Party, new Set());
        }
        partyMembers.get(member.Party).add(item.MemberId);
      }
    }
  }

  // Convert partyMembers Map to partyCount object with member counts
  const partyCount = Object.fromEntries(
    Array.from(partyMembers.entries()).map(([party, members]) => [
      party,
      members.size // Use size of Set to get unique member count
    ])
  );

  return {
    speakerCount: uniqueSpeakers.size,
    contributionCount,
    partyCount
  };
}