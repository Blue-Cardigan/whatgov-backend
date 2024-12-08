WITH structure_checks AS (
  SELECT 
    date,
    -- ai_topics check remains the same
    CASE WHEN (
      SELECT bool_and(
        jsonb_typeof(topic->'speakers') = 'array' 
        AND (
          SELECT bool_and(
            speaker ? 'name' 
            AND speaker ? 'memberId'
            AND speaker ? 'party'
            AND speaker ? 'constituency'
            AND speaker ? 'subtopics'
            AND speaker ? 'frequency'
          )
          FROM jsonb_array_elements(topic->'speakers') speaker
        )
      )
      FROM jsonb_array_elements(ai_topics) topic
    ) THEN true ELSE false END as valid_topics,
    
    -- ai_key_points check remains the same
    CASE WHEN (
      SELECT bool_and(
        point ? 'point'
        AND point ? 'context'  -- Allow null values
        AND point ? 'speaker'
        AND point ? 'support'
        AND point ? 'opposition'
        AND point ? 'keywords'
        AND jsonb_typeof(point->'speaker') = 'object'
        AND (point->'speaker' ? 'name')  -- Only require name in speaker object
        AND jsonb_typeof(point->'support') = 'array'
        AND jsonb_typeof(point->'opposition') = 'array'
        AND jsonb_typeof(point->'keywords') = 'array'
        AND (
          CASE 
            WHEN jsonb_array_length(point->'support') > 0 THEN
              (SELECT bool_and(
                speaker ? 'name'  -- Only require name in support speakers
              )
              FROM jsonb_array_elements(point->'support') speaker)
            ELSE true
          END
        )
        AND (
          CASE 
            WHEN jsonb_array_length(point->'opposition') > 0 THEN
              (SELECT bool_and(
                speaker ? 'name'  -- Only require name in opposition speakers
              )
              FROM jsonb_array_elements(point->'opposition') speaker)
            ELSE true
          END
        )
      )
      FROM jsonb_array_elements(ai_key_points) point
    ) THEN true ELSE false END as valid_key_points,
    
    -- Updated ai_comment_thread check
    CASE WHEN (
      jsonb_typeof(ai_comment_thread) = 'array'
      AND (
        SELECT bool_and(
          comment ? 'id'
          AND comment ? 'author'
          AND comment ? 'content'
          AND comment ? 'votes'
          AND jsonb_typeof(comment->'author') = 'object'
          AND (
            comment->'author' ? 'name'  -- Only name is required
          )
          AND jsonb_typeof(comment->'votes') = 'object'
          AND (
            comment->'votes' ? 'upvotes'
            AND comment->'votes' ? 'downvotes'
            AND comment->'votes' ? 'upvotes_speakers'
            AND comment->'votes' ? 'downvotes_speakers'
            AND jsonb_typeof(comment->'votes'->'upvotes_speakers') = 'array'
            AND jsonb_typeof(comment->'votes'->'downvotes_speakers') = 'array'
            AND (
              SELECT bool_and(
                speaker ? 'name'  -- Only name is required
              )
              FROM jsonb_array_elements(
                (comment->'votes'->'upvotes_speakers') || 
                (comment->'votes'->'downvotes_speakers')
              ) speaker
              WHERE jsonb_typeof(speaker) = 'object'
            )
          )
        )
        FROM jsonb_array_elements(ai_comment_thread) comment
      )
    ) THEN true ELSE false END as valid_comments
  FROM debates
)
SELECT 
  date,
  COUNT(*) FILTER (WHERE valid_topics) as valid_topics_count,
  COUNT(*) FILTER (WHERE NOT valid_topics) as invalid_topics_count,
  COUNT(*) FILTER (WHERE valid_key_points) as valid_key_points_count,
  COUNT(*) FILTER (WHERE NOT valid_key_points) as invalid_key_points_count,
  COUNT(*) FILTER (WHERE valid_comments) as valid_comments_count,
  COUNT(*) FILTER (WHERE NOT valid_comments) as invalid_comments_count
FROM structure_checks
GROUP BY date
ORDER BY date DESC;