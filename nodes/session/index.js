const {sql} = require('slonik')

async function sessionInfo(token, request) {
  const initialValue = {
    method: {},
    user: {}
  }
  if (!token) {
    return initialValue
  }
  const exists = await request.pgpool.exists(sql`select id from sessions where token=${token}`)

  if (!exists) {
    return initialValue
  }

  try {
    const session = await request.pgconn.one(sql`select * from sessions where token=${token}`)
    const method = await request.pgconn.one(sql`select * from signin_methods where id=${session.signin_method_id}`)
    const user = await request.pgconn.one(sql`select * from users where id=${session.user_id}`)
    
    return {
      revoked: session.revoked,
      method: {
        name: method.name,
        additional_params: method.additional_params
      },
      user: {
        email: user.email,
        phone_num: user.phone_num,
        phone_num_country: user.phone_num_country
      }
    }  
  } catch (error) {
    console.log(error)
    return initialValue
  }

  return initialValue
}

module.exports = {
  sessionInfo: sessionInfo
}
