import { openai } from '../services/openai.js';
import { File } from 'buffer';
import logger from '../utils/logger.js';

function formatDebateForVector(debate, memberDetails) {
  const { Overview, Items = [], summary, keyPoints, topics = [], divisions = [] } = debate;
  const type = Overview.Type;

  // Extract and deduplicate keywords from key points
  const keywords = Array.from(new Set(
    (keyPoints?.keyPoints || [])
      .flatMap(point => point.keywords || [])
      .filter(Boolean)
  ));

  // Get all unique speakers with their details
  const speakers = Items
    .filter(item => item?.ItemType === 'Contribution')
    .map(item => {
      const memberInfo = memberDetails.get(item.MemberId);
      return {
        name: memberInfo?.DisplayAs || item.MemberName || '',
        party: memberInfo?.Party || null,
        constituency: memberInfo?.MemberFrom || null
      };
    })
    .filter((speaker, index, self) => 
      index === self.findIndex(s => 
        s.name === speaker.name
      )
    );

  // Format the content sections
  const sections = [
    // Metadata section
    {
      title: 'Metadata',
      content: [
        `Title: ${Overview.Title}`,
        `Date: ${Overview.Date} (${new Date(Overview.Date).toLocaleDateString('en-UK', { weekday: 'long' })})`,
        `Type: ${type}`,
        `Location: ${Overview.Location}`,
        `House: ${Overview.House}`,
        keywords.length ? `Keywords: ${keywords.join(', ')}` : ''
      ].filter(Boolean).join('\n')
    },
    
    // Speakers section
    {
      title: 'Speakers',
      content: speakers
        .map(s => `- ${s.name}${s.party ? ` (${s.party}${s.constituency ? `, ${s.constituency}` : ''})` : ''}`)
        .join('\n')
    },
    
    // Summary section
    {
      title: 'Summary',
      content: [
        summary?.title || '',
        summary?.tone ? `Tone: ${summary.tone}` : '',
        summary?.overview || '',
        summary?.summary || '',
      ].filter(Boolean).join('\n\n')
    },

    // Topics section
    {
      title: 'Topics',
      content: topics.map(topic => {
        const topicSpeakers = topic.speakers
          .map(s => {
            const details = [s.name];
            if (s.party) details.push(s.party);
            if (s.constituency) details.push(s.constituency);
            if (s.subtopics?.length) details.push(`discussing ${s.subtopics.join(', ')}`);
            return `  - ${details.join(', ')}`;
          })
          .join('\n');

        return `${topic.topic}:\n${topicSpeakers}`;
      }).join('\n\n')
    },

    // Key Points section
    {
      title: 'Key Points',
      content: (keyPoints?.keyPoints || []).map(point => {
        const sections = [];
        
        // Main point
        sections.push(`Point: ${point.point}`);
        
        // Speaker
        if (point.speaker?.name) {
          const speakerDetails = [point.speaker.name];
          if (point.speaker.party) speakerDetails.push(point.speaker.party);
          if (point.speaker.constituency) speakerDetails.push(point.speaker.constituency);
          sections.push(`Made by: ${speakerDetails.join(', ')}`);
        }

        // Support
        if (point.support?.length) {
          sections.push('Supported by:');
          sections.push(point.support.map(s => 
            `  - ${[s.name, s.party, s.constituency].filter(Boolean).join(', ')}`
          ).join('\n'));
        }

        // Opposition
        if (point.opposition?.length) {
          sections.push('Opposed by:');
          sections.push(point.opposition.map(s => 
            `  - ${[s.name, s.party, s.constituency].filter(Boolean).join(', ')}`
          ).join('\n'));
        }

        // Keywords and Context
        if (point.keywords?.length) {
          sections.push(`Keywords: ${point.keywords.join(', ')}`);
        }
        if (point.context) {
          sections.push(`Context: ${point.context}`);
        }

        return sections.join('\n');
      }).join('\n\n')
    },

    // Divisions section (if present)
    divisions?.length ? {
      title: 'Divisions',
      content: divisions.map(division => {
        const sections = [
          `Division ${division.division_number || ''}`,
          `Result: Ayes ${division.ayes_count || 0}, Noes ${division.noes_count || 0}`,
        ];

        // Add AI-generated content if available
        if (division.ai_question) {
          sections.push(`Question: ${division.ai_question}`);
        }
        if (division.ai_topic) {
          sections.push(`Topic: ${division.ai_topic}`);
        }
        if (division.ai_context) {
          sections.push(`Context: ${division.ai_context}`);
        }
        if (division.ai_key_arguments?.for?.length) {
          sections.push('Arguments For:');
          sections.push(division.ai_key_arguments.for
            .map(arg => `  - ${arg}`)
            .join('\n')
          );
        }
        if (division.ai_key_arguments?.against?.length) {
          sections.push('Arguments Against:');
          sections.push(division.ai_key_arguments.against
            .map(arg => `  - ${arg}`)
            .join('\n')
          );
        }

        // Add voting records if available
        if (division.aye_members?.length) {
          sections.push('Voted Aye:');
          sections.push(division.aye_members
            .map(member => {
              const details = [member.display_as];
              if (member.party) details.push(member.party);
              return `  - ${details.join(', ')}`;
            })
            .join('\n')
          );
        }
        if (division.noe_members?.length) {
          sections.push('Voted No:');
          sections.push(division.noe_members
            .map(member => {
              const details = [member.display_as];
              if (member.party) details.push(member.party);
              return `  - ${details.join(', ')}`;
            })
            .join('\n')
          );
        }

        return sections.join('\n');
      }).join('\n\n')
    } : null,
  ].filter(Boolean); // Remove null sections

  // Combine all sections
  return sections
    .map(section => `# ${section.title}\n\n${section.content}`)
    .join('\n\n');
}

export async function createAndUploadVectorFile(debate, memberDetails) {
  try {
    // Only proceed if we have all required data
    if (!debate?.Items || !debate?.Overview) {
      return null;
    }

    // Format the debate content
    const content = formatDebateForVector(debate, memberDetails);

    // Create virtual file
    const virtualFile = new File(
      [Buffer.from(content)],
      `${debate.Overview.ExtId}.txt`,
      { type: 'text/plain' }
    );

    // Upload to OpenAI
    const uploadedFile = await openai.files.create({
      file: virtualFile,
      purpose: 'assistants'
    });

    logger.debug(`Created vector file for debate ${debate.Overview.ExtId}`, {
      fileId: uploadedFile.id,
      filename: uploadedFile.filename
    });

    return uploadedFile;

  } catch (error) {
    logger.error('Failed to create vector file:', error);
    return null;
  }
}
