const {sql} = require('slonik')

module.exports = async function(request) {
  try {
    const result = await request.pgconn.many(sql`
    select * from proposals order by created_at desc
    `)
    return result
  } catch (error) {
    console.log(error)
    return {
      error
    }
  }
}