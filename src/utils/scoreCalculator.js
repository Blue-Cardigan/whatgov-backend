export function calculateDebateScore(debateDetails) {
  const factors = {
    controversy: 0,
    participation: 0,
    diversity: 0,
    discussion: 0
  };

  // Calculate controversy score based on AI tone
  factors.controversy = (
    (debateDetails.tone === 'contentious' ? 1 : 
     debateDetails.tone === 'collaborative' ? 0.3 : 
     0.6)
  );

  // Calculate participation score using speaker and contribution counts
  factors.participation = (
    Math.min(debateDetails.speakerCount / 20, 1) * 0.4 +
    Math.min(debateDetails.contributionCount / 50, 1) * 0.6
  );

  // Calculate party diversity score using partyCount
  const partyCount = debateDetails.partyCount || {};
  const parties = Object.keys(partyCount).length;
  const totalSpeakers = Object.values(partyCount).reduce((sum, count) => sum + count, 0);
  
  const partyDistribution = Object.values(partyCount).reduce((sum, count) => {
    const proportion = count / totalSpeakers;
    return sum - (proportion * Math.log2(proportion)); // Shannon entropy
  }, 0);

  factors.diversity = Math.min(
    (parties / 6) * 0.4 + (partyDistribution / 2) * 0.6,
    1
  );

  // Calculate discussion quality score using keyPoints
  const keyPoints = debateDetails.keyPoints || [];
  const pointsWithInteraction = keyPoints.filter(
    point => (point.support?.length || 0) + (point.opposition?.length || 0) > 0
  ).length;
  factors.discussion = Math.min(pointsWithInteraction / 5, 1);

  // Calculate final score with weights
  const score = (
    factors.controversy * 0.3 +
    factors.participation * 0.2 +
    factors.diversity * 0.2 +
    factors.discussion * 0.3
  );

  return {
    score,
    factors
  };
} 