const { Client } = require("@notionhq/client")

module.exports = async (notion) => {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DB_ID_SEASONS,
    sorts: [{
      property: 'Number',
      direction: 'descending'
    }]
  })

  if (response.error) {
    return response
  }

  return response.results
    .map(o => {
      return {
        id: o.id,
        num: o.properties.Number.number,
        startDate: o.properties['Start Date'].date.start,
        endDate: o.properties['End Date'].date.start,
        title: o.properties.Name.title[0].text.content
      }
    })
}