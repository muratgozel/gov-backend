const {sql} = require('slonik')
const { v4: uuidv4 } = require('uuid')

module.exports = async function registerUser(user, request) {
  const uuid = uuidv4()

  let query = null
  if (user.email) {
    query = sql`insert into users (uuid, email) values (${uuid}, ${user.email}) returning id`
  }
  else {
    query = sql`insert into users (uuid, phone_num, phone_num_country) values (${uuid}, ${user.phone_num}, ${user.phone_num_country}) returning id`
  }

  try {
    const result = await request.pgconn.query(query)
  } catch (error) {
    return {
      error
    }
  }

  return {
    id: result.id, uuid
  }
}