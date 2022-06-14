const { Client } = require("@notionhq/client")

module.exports = async (notion, season) => {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DB_ID_OBJECTIVES,
    filter: {
      and: [
        {
          property: 'Season',
          relation: {
            contains: season
          }
        }
      ]
    },
    sorts: [{
      property: 'Category',
      direction: 'ascending'
    }]
  })

  if (response.results.length === 0) {
    return {
      season,
      okrs: []
    }  
  }

  const objectives = response.results
    .map(o => {
      return {
        id: o.id,
        category: o.properties.Category.title[0].plain_text,
        description: o.properties.Objective.rich_text[0].plain_text
      }
    })
  
  const response2 = await notion.databases.query({
    database_id: process.env.NOTION_DB_ID_KEYRESULTS,
    filter: {
      or: objectives.map(o => {
        return {
          property: 'Objective',
          relation: {
            contains: o.id
          }
        }
      })
    }
  })

  if (response2.results.length === 0) {
    return {
      season,
      okrs: []
    }  
  }

  const krs = response2.results
    .map(o => {
      return {
        id: o.id,
        title: o.properties.Name.title[0].plain_text,
        objectiveId: o.properties.Objective.relation[0].id
      }
    })

  for (let i = 0; i < objectives.length; i++) {
    const objective = objectives[i]
    objectives[i].keyResults = krs
      .filter(o => o.objectiveId == objective.id)
      .map(o => {
        delete o.objectiveId
        return o;
      })
  }

  return {
    season,
    okrs: objectives
  }
}