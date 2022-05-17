const {sql} = require('slonik')
const { v4: uuidv4 } = require('uuid')
const registerUser = require('./registerUser')

module.exports = async function signinWithDiscourse(userParams, request) {
  const {email} = userParams
  let user = {
    email: email
  }
  let method = {
    name: 'discourse'
  }

  // register user if not exists
  const exists = await request.pgpool.exists(sql`select id from users where email=${email}`)
  if (!exists) {
    const registerResult = await registerUser({email: email}, request)
    if (registerResult.error) return registerResult
    user.id = registerResult.id
    user.uuid = registerResult.uuid
  }
  else {
    try {
      const userResult = await request.pgconn.one(sql`select id, uuid from users where email=${email}`)
      user.id = userResult.id
      user.uuid = userResult.uuid  
    } catch (error) {
      return {error}
    }
  }

  // create signin method if not exists
  const methodExists = await request.pgpool.exists(sql`select id from signin_methods where user_id=${user.id} and name='discourse'`)
  if (!methodExists) {
    method.uuid = uuidv4()
    method.additional_params = userParams
    try {
      const insertedMethod = await request.pgconn.query(sql`insert into signin_methods (uuid, name, user_id, additional_params) values (${method.uuid}, ${method.name}, ${user.id}, ${JSON.stringify(method.additional_params)}) returning id`)
      method.id = insertedMethod.rows[0].id
    } catch (error) {
      return {
        error
      }
    }
  }
  else {
    try {
      const methodResult = await request.pgconn.one(sql`select * from signin_methods where user_id=${user.id} and name='discourse'`)
      method.id = methodResult.id
      method.uuid = methodResult.uuid
      method.additional_params = userParams
      await request.pgconn.query(sql`update signin_methods set additional_params=${JSON.stringify(userParams)} where user_id=${user.id} and name='discourse'`)
    } catch (error) {
      return {
        error
      }
    }
  }

  // create session
  const token = uuidv4()
  try {
    await request.pgconn.query(sql`insert into sessions (user_id, signin_method_id, token) values (${user.id}, ${method.id}, ${token})`)

    return {
      token
    }
  } catch (error) {
    return {
      error
    }
  }
}