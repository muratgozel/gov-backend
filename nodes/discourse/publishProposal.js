const {sql} = require('slonik')

module.exports = async (request) => {
  const got = (await import('got')).default.extend()

  const sampleProposalUuid = '1a8a6f49-61f7-4c46-b5a7-19a197f97c23'

  // get proposal
  const exists = await request.pgpool.exists(sql`select id from proposals where uuid=${sampleProposalUuid}`)
  if (!exists) {
    return {error: new Error('proposal_not_found')}
  }

  let proposal = null;
  try {
    proposal = await request.pgconn.one(sql`
      select *
      from proposals 
      where uuid=${sampleProposalUuid}`
    )
  } catch (error) {
    console.log(error)
    return {error: new Error('publish_proposal_error')}
  }

  // get user's forum username
  let username = null;
  try {
    const sm = await request.pgconn.one(sql`
      select * from signin_methods where user_id=${proposal.user_id}
    `)
    username = sm.additional_params.username
  } catch (error) {
    console.log(error)
    return {error: new Error('publish_proposal_error')}
  }

  const endpoint = process.env.DISCOURSE_URL + '/posts.json'
  try {
    const topic = await got.post(endpoint, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Api-Key': process.env.DISCOURSE_API_KEY,
        'Api-Username': username
      },
      json: {
        title: proposal.title,
        raw: `Hello forum. Lorem ipsum di samet.

[poll type=regular results=always chartType=bar]
* a
* b
* c
[/poll]`,
        category: 5
      }
    }).json()

    return {
      id: topic.topic_id, 
      username: topic.username,
      slug: topic.topic_slug
    }
  } catch (error) {
    console.log(error)
    return {error: {code: 'publish_proposal_error', message: JSON.parse(error.response.body).errors[0]}}
  }
}