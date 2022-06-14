const { Client } = require("@notionhq/client")

module.exports = async (notion) => {
  const now = (new Date(Date.now())).toISOString()
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DB_ID_SEASONS,
    filter: {
      and: [
        {
          property: 'Start Date',
          date: {
            on_or_after: now
          }  
        },
        {
          property: 'End Date',
          date: {
            on_or_before: now
          }
        }
      ]
    }
  })

  if (response.error) {
    return response
  }

  return response.results
}