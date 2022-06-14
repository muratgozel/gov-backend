const {sql} = require('slonik')
const { v4: uuidv4 } = require('uuid')

module.exports = async function submit(request, title, json) {
  const uuid = uuidv4()
  const status = 'SUBMITTED'

  try {
    const result = await request.pgconn.query(sql`
    insert into proposals (
      uuid, user_id, status, title, json, voting_platform, voting_method
    ) values (
      ${uuid}, ${request.auth.session.user_id}, ${status}, ${title}, 
      ${JSON.stringify(json)}, 
      ${json.votingPlatform}, ${json.votingMethod}
    ) returning id, created_at`)
    return {
      uuid, status, title, json,
      id: result.rows[0].id, createdAt: result.rows[0].created_at, 
      userId: request.auth.session.user_id
    }
  } catch (error) {
    console.log(error)
    return {
      error
    }
  }
}