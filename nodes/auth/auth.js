const {sql} = require('slonik')

module.exports = async function auth(request) {
  const initialState = {
    error: new Error('auth_token_missing')
  }
  const token = (request.headers.authorization || '').replace('Bearer ', '')

  if (!token) {
    return initialState
  }

  const exists = await request.pgpool.exists(sql`select id from sessions where token=${token}`)

  if (!exists) {
    return {error: new Error('auth_token_invalid')}
  }

  try {
    const session = await request.pgconn.one(sql`
      select 
        sessions.*, 
        signin_methods.name as signin_method, signin_methods.additional_params as signin_method_params,
        users.id as user_id, users.uuid as user_uuid, users.email as user_email, users.phone_num as user_phone_num, users.phone_num_country as user_phone_num_country
      from sessions 
      inner join signin_methods on signin_methods.id=sessions.signin_method_id 
      inner join users on users.id=sessions.user_id
      where sessions.token=${token} and signin_methods.name='discourse' and users.disabled is false`
    )
    
    if (session.revoked) {
      return {error: new Error('auth_token_revoked')}
    }

    return {session}
  } catch (error) {
    console.log(error)
    return {error: new Error('auth_token_error')}
  }
}