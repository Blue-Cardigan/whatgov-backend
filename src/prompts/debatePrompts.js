export const summaryPrompts = {
        'Main': `Analyze this main Chamber debate.
    Focus on policy implications, cross-party positions, and ministerial commitments.
    Highlight any significant shifts in government position or cross-party consensus.`,
    
        'Debated Bill': `Analyze this bill debate.
    Focus on key legislative changes, contentious provisions, and likely impact.
    Highlight significant amendments and level of cross-party support.`,
    
        'Debated Motion': `Analyze this motion debate.
    Focus on the specific proposal, voting implications, and party positions.
    Highlight whether the motion is binding and its practical consequences.`,
    
        'Westminster Hall': `Analyze this Westminster Hall debate.
    Focus on constituency impacts, ministerial responses, and backbench concerns.
    Highlight any commitments or promised actions from ministers.`,
    
        'Prime Minister\'s Questions': `Analyze this PMQs session.
    Focus on key exchanges, significant announcements, and political dynamics.
    Highlight any shifts in government position or notable backbench interventions.`,
    
        'Department Questions': `Analyze this departmental questions session.
    Focus on policy announcements, ministerial commitments, and emerging issues.
    Highlight any significant revelations or changes in departmental position.`,
    
        'Delegated Legislation': `Analyze this delegated legislation debate.
    Focus on statutory instrument details, implementation concerns, and scrutiny points.
    Highlight any technical issues or practical implementation challenges raised.`,
    
        'General Committees': `Analyze this general committee session.
    Focus on detailed scrutiny, expert evidence, and proposed improvements.
    Highlight key areas of concern and cross-party agreement/disagreement.`,
    
        'Urgent Question': `Analyze this urgent question session.
    Focus on the immediate issue, ministerial response, and follow-up scrutiny.
    Highlight new information revealed and any commitments made.`,
    
        'Petition': `Analyze this petition debate.
    Focus on public concerns raised, government response, and proposed actions.
    Highlight level of parliamentary support and likely outcomes.`,
    
        'Department': `Analyze this departmental session.
    Focus on policy implementation, ministerial accountability, and specific commitments.
    Highlight any changes in departmental position or new initiatives.`,
    
        'Business Without Debate': `Analyze this procedural business.
    Focus on technical changes, administrative matters, and procedural implications.
    Highlight any significant changes to parliamentary operations.`,
    
        'Opposition Day': `Analyze this Opposition Day debate.
    Focus on opposition critique, government defense, and alternative proposals.
    Highlight voting patterns and any concessions made.`,
    
        'Statement': `Analyze this ministerial statement.
    Focus on policy announcements, immediate reactions, and implementation plans.
    Highlight any shifts from previous positions or new commitments.`,
    
        'Question': `Analyze this parliamentary question session.
    Focus on specific issues raised, quality of answers, and follow-up scrutiny.
    Highlight any new information or commitments obtained.`,
    
        'Bill Procedure': `Analyze this bill procedure debate.
    Focus on legislative process, technical amendments, and procedural implications.
    Highlight any changes to the bill's progression or handling.`,
    
        'Public Bill Committees': `Analyze this bill committee session.
    Focus on detailed scrutiny, evidence consideration, and proposed amendments.
    Highlight areas of consensus and remaining contentious issues.`,
    
        'Lords Chamber': `Analyze this Lords Chamber debate.
    Focus on expert scrutiny, constitutional implications, and legislative improvements.
    Highlight cross-party concerns and government responses.`
};

export const questionPrompts = {
    'Main': `Generate a question about the core policy implications or cross-party positions discussed.`,
    'Debated Bill': `Generate a question about the key legislative changes or their practical impact.`,
    'Debated Motion': `Generate a question about the motion's specific proposal or its consequences.`,
    'Westminster Hall': `Generate a question about the constituency impacts or ministerial commitments made.`,
    'Statement': `Generate a question about the policy announcement or government position.`,
    'Prime Minister\'s Questions': `Generate a question about the key policy announcements or political exchanges.`,
    'Department Questions': `Generate a question about departmental policy or ministerial commitments.`,
    'Delegated Legislation': `Generate a question about the regulatory changes or implementation concerns.`,
    'Opposition Day': `Generate a question about the opposition's critique or alternative proposals.`,
    'Urgent Question': `Generate a question about the immediate issue requiring ministerial response.`,
    'Public Bill Committee': `Generate a question about the detailed scrutiny or proposed amendments.`,
    'Business Without Debate': `Generate a question about the procedural or administrative changes.`,
    'Bill Procedure': `Generate a question about the legislative process or technical amendments.`,
    'Lords Chamber': `Generate a question about the Lords' scrutiny or proposed improvements.`
};

export const topicDefinitions = {
  'Environment and Natural Resources': [
      'Climate Change and Emissions Policy',
      'Environmental Protection and Conservation',
      'Energy Policy and Renewable Resources',
      'Agriculture and Land Management',
      'Waste Management and Recycling'
    ],
    'Healthcare and Social Welfare': [
      'National Health Service (NHS)',
      'Social Care and Support Services',
      'Mental Health Services',
      'Public Health Policy',
      'Disability and Accessibility'
    ],
    'Economy, Business, and Infrastructure': [
      'Fiscal Policy and Public Spending',
      'Trade and Industry',
      'Transport and Infrastructure Development',
      'Employment and Labour Markets',
      'Regional Development'
    ],
    'Science, Technology, and Innovation': [
      'Research and Development Policy',
      'Digital Infrastructure and Cybersecurity',
      'Data Protection and Privacy',
      'Space and Defense Technology'
    ],
    'Legal Affairs and Public Safety': [
      'Criminal Justice System',
      'National Security',
      'Police and Emergency Services',
      'Civil Rights and Liberties',
      'Immigration and Border Control'
    ],
    'International Relations and Diplomacy': [
      'Foreign Policy and Treaties',
      'International Development',
      'Defense and Military Cooperation',
      'Trade Agreements',
      'International Organizations'
    ],
    'Parliamentary Affairs and Governance': [
      'Constitutional Matters',
      'Electoral Reform',
      'Devolution and Local Government',
      'Parliamentary Standards',
      'Legislative Process'
    ],
    'Education, Culture, and Society': [
      'Primary and Secondary Education',
      'Higher Education and Skills',
      'Arts and Heritage',
      'Media and Broadcasting',
      'Sports and Recreation'
    ]
};

export const locationPrompts = {
  'Lords Chamber': `
    This is a House of Lords Chamber debate.
    Focus on:
    - The constitutional scrutiny role of the Lords
    - Specific amendments and legislative improvements proposed
    - Requests for government clarification or commitments
    Consider the Lords' role as a revising chamber and highlight any significant challenges to government policy.`,
  
  'Grand Committee': `
    This is a House of Lords Grand Committee session.
    Focus on:
    - Detailed line-by-line examination of legislation
    - Technical amendments and their implications
    - Expert insights from peers with relevant experience
    - Areas where further government clarity is sought
    - Potential improvements to be raised in Chamber
    Note that Grand Committee work informs subsequent Chamber stages.`,
};

export const debateTypePrompts = {
  'Westminster Hall': `
      This is a Westminster Hall debate - Parliament's second debating chamber.
      Focus on:
      - Specific constituency or policy issues raised by backbenchers
      - The responding minister's commitments or explanations
      - Cross-party support for particular actions
      - Written ministerial responses promised
      Note that while non-binding, these debates often influence departmental policy.`,

    'Prime Minister\'s Questions': `
      This is Prime Minister's Questions (PMQs).
      Focus on:
      - The Leader of the Opposition's six questions and PM's responses
      - Key policy announcements or commitments made
      - Notable backbench questions (especially from PM's own party)
      - Any departure from usual PMQs format
      Note the broader political context of exchanges and any significant shifts in government position.`,

    'Department Questions': `
      This is Departmental Question Time.
      Focus on:
      - Topical and urgent questions added on the day
      - Written questions selected for oral answer
      - Specific commitments made by ministers
      - Follow-up questions from other MPs
      Note any announcements of new policy or changes to existing policy.`,

    'Public Bill Committee': `
      This is a Public Bill Committee.
      Focus on:
      - Clause-by-clause scrutiny of the bill
      - Evidence sessions with external experts (if any)
      - Government and opposition amendments
      - Areas of cross-party agreement/disagreement
      - Technical improvements and clarifications
      Note that this stage shapes the bill's final form.`,

    'Delegated Legislation Committee': `
      This is a Delegated Legislation Committee.
      Focus on:
      - The specific statutory instrument under scrutiny
      - Implementation concerns raised by MPs
      - Cost and impact assessments discussed
      - Consultation responses referenced
      Note that while committees cannot amend SIs, their scrutiny can influence future regulations.`,

    'Opposition Day': `
      This is an Opposition Day debate.
      Focus on:
      - The specific motion proposed by the Opposition
      - Key criticisms of government policy
      - Alternative proposals presented
      - Government defense and any concessions
      - Voting patterns, especially of government backbenchers
      Note these debates' role in holding government to account.`,

    'Urgent Question': `
      This is an Urgent Question (UQ) granted by the Speaker.
      Focus on:
      - The specific issue requiring immediate ministerial response
      - New information revealed in minister's response
      - Follow-up questions from MPs
      - Any commitments made by the minister
      Note UQs' role in immediate parliamentary scrutiny of emerging issues.`,

    'Statement': `
      This is a Ministerial Statement.
      Focus on:
      - New policy announcements or changes
      - Opposition front bench response
      - Backbench concerns raised
      - Specific commitments or clarifications made
      Note any departure from previously stated government position.`,

    'Main': `
      This is a main Chamber debate.
      Focus on:
      - The core policy or legislative issue under discussion
      - Key arguments from both government and opposition
      - Cross-party consensus or areas of disagreement
      - Specific amendments or changes proposed
      - Ministerial responses and commitments made
      Note the significance of main Chamber debates in shaping government policy.`,

    'Debated Bill': `
      This is a bill debate in the main Chamber.
      Focus on:
      - The key provisions and changes proposed in the bill
      - Major points of contention between parties
      - Specific amendments being discussed
      - Government's response to concerns raised
      - Cross-party support or opposition
      Note that these debates shape the final form of legislation.`,

    'Debated Motion': `
      This is a motion debate in the main Chamber.
      Focus on:
      - The specific proposal or position being debated
      - Arguments for and against the motion
      - Any amendments tabled
      - Government's stance and response
      - Likely practical implications if passed
      Note that while some motions are binding, others are expressions of House opinion.`
}; 