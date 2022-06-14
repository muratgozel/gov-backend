const {randomBytes, createHmac} = require('crypto')
const {URLSearchParams} = require('url')
const { Client } = require("@notionhq/client")
const getSlug = require('speakingurl')
const dayjs = require('dayjs')
const {createPool} = require('slonik')
const pgpool = createPool(process.env.PG_CONN_STR)
const Redis = require('ioredis')
const redis = new Redis(process.env.REDIS_CONN_STR)
const fastify = require('fastify')({ logger: true })
fastify.register(require('@fastify/sensible'))
const {signinWithDiscourse} = require('./nodes/signin')
const {sessionInfo} = require('./nodes/session')
const {getCurrentSeason, getAllSeasons, okrs} = require('./nodes/notion')
const {auth} = require('./nodes/auth')
const proposal = require('./nodes/proposal')
const {publishProposal} = require('./nodes/discourse')

fastify.register(require('@fastify/cors'), (ins) => async (request, callback) => {
  const origin = request.headers.origin
  const hostname = origin ? new URL(origin).hostname : null
  const corsopts = {
    origin: true, // allow all origins
    credentials: true,
    allowedHeaders: ["Origin, Authorization, X-Requested-With, Content-Type, Accept"]
  }
  return callback(null, corsopts)
})

fastify.addHook('onRequest', async (request, reply) => {
  request.redis = redis
  request.pgpool = pgpool
  request.notion = new Client({
    auth: process.env.NOTION_INTEGRATION_TOKEN
  })
})

fastify.get('/', async (request, reply) => {
  return {}
})

fastify.get('/session', async (request, reply) => {
  const token = (request.headers.authorization || '').replace('Bearer ', '')
  const result = await request.pgpool.connect(async (connection) => {
    request.pgconn = connection
    return await sessionInfo(token, request)
  })

  return result
})

fastify.get('/discourse/signin', async (request, reply) => {
  const nonce = randomBytes(64).toString('hex')
  const returnUrl = process.env.DISCOURSE_SSO_RETURN_URL
  const payload = `nonce=${nonce}&return_sso_url=${returnUrl}`
  const payloadB64 = Buffer.from(payload).toString('base64')
  const payloadUrlEncoded = encodeURIComponent(payloadB64)
  const signature = createHmac('sha256', process.env.DISCOURSE_SSO_SECRET).update(payloadB64).digest('hex')
  const redirectUrl = `${process.env.DISCOURSE_URL}/session/sso_provider?sso=${payloadUrlEncoded}&sig=${signature}`

  await request.redis.set(`discourse:signin:${nonce}`, '1', 'EX', 300)

  return { redirect: encodeURIComponent(redirectUrl) }
})

fastify.get('/discourse/signin/token', async (request, reply) => {
  if (!request.query.sig || !request.query.sso) {
    return reply.badRequest()
  }

  const sso = Buffer.from(request.query.sso, 'base64').toString('utf8')
  const params = new URLSearchParams(sso)
  const bool = await request.redis.exists(`discourse:signin:${params.get('nonce')}`)

  if (!bool) {
    return reply.badRequest('Nonce mismatch.')
  }

  const signature = createHmac('sha256', process.env.DISCOURSE_SSO_SECRET).update(request.query.sso).digest('hex')

  if (Buffer.from(signature).equals(Buffer.from(request.query.sig)) !== true) {
    return reply.badRequest('Signature mismatch.')
  }

  const userParams = {}
  params.forEach((v, n) => {
    if (n != 'nonce' && n != 'return_sso_url') userParams[n] = v
  })

  const result = await request.pgpool.connect(async (connection) => {
    request.pgconn = connection
    return await signinWithDiscourse(userParams, request)
  })

  return reply.redirect(process.env.FRONTEND_URL + '/?token=' + (result.token || ''))
})

fastify.get('/notion/teams', async (request, reply) => {
  const response = await request.notion.databases.query({
    database_id: process.env.NOTION_DB_ID_TEAMS
  })
  if (response.error) {
    return response.error
  }
  return response.results.map(o => {
    return {
      id: o.id, title: o.properties.Name.title[0].text.content
    }
  })
})

fastify.get('/notion/toolbox', async (request, reply) => {
  const response = await request.notion.databases.query({
    database_id: process.env.NOTION_DB_ID_TOOLBOX,
    filter: {
      property: 'Published',
      checkbox: {
        equals: true
      }
    }
  })
  if (response.error) {
    return response.error
  }

  return response.results
    .filter(o => o.properties.Published.checkbox === true)
    .map(o => {
      const title = o.properties['Template Title'].title[0].plain_text
      return {
        id: o.properties.ID.formula.string,
        title: title,
        slug: getSlug(title),
        votingMethod: o.properties['Voting Method'].select.name,
        votingPlatform: o.properties['Voting Platform'].select.name,
        svelteComponent: o.properties['Svelte Component'].rich_text[0].plain_text,
        components: {
          fixed: o.properties['Fixed Components'].multi_select.map(fc => fc.name),
          flexible: o.properties['Flexible Components'].multi_select.map(fc => fc.name)
        }
      }
    })
})

fastify.get('/notion/seasons-schedule', async (request, reply) => {
  const now = dayjs(Date.now())
  const list = await getAllSeasons(request.notion)

  let currentSeason=null, prevSeason=null, nextSeason=null, offseason=false
      closestNextSeasonDistance=3000000, closestPrevSeasonDistance=3000000,
      prevSeasonByDate=null, nextSeasonByDate=null;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const start = dayjs(o.startDate)
    const end = dayjs(o.endDate)
    if (now.isAfter(start) && now.isBefore(end)) {
      currentSeason = o

      if (i - 1 > -1) nextSeason = list[i-1]
      if (list.length - 1 >= i) prevSeason = list[i+1]
    }

    // in case of off-season, we find prev/next seasons by current date
    const diff = start.diff(now, 'second')
    if (diff > 0 && diff < closestNextSeasonDistance) {
      nextSeasonByDate = o
      closestNextSeasonDistance = diff
    }
    const diff2 = end.diff(now, 'second')
    if (diff2 < closestPrevSeasonDistance) {
      prevSeasonByDate = o
      closestPrevSeasonDistance = diff2
    }
  }
  if (!currentSeason) {
    offseason = true
    prevSeason = prevSeasonByDate
    nextSeason = nextSeasonByDate
  }

  return {
    offseason, currentSeason, prevSeason, nextSeason, list
  }
})

fastify.get('/notion/okrs/', async (request, reply) => {
  if (!request.query.season) {
    return reply.badRequest()
  }

  const result = await request.pgpool.connect(async (connection) => {
    request.pgconn = connection
    request.auth = await auth(request)

    if (request.auth.error) {
      return {error: request.auth.error.message}
    }
    
    const {season} = request.query
    return await okrs(request.notion, season)
  })

  return result;
})

fastify.post('/proposal/submit', async (request, reply) => {
  const {title, json} = request.body
  const result = await request.pgpool.connect(async (connection) => {
    request.pgconn = connection
    request.auth = await auth(request)

    if (request.auth.error) {
      return {error: request.auth.error.message}
    }
    
    return await proposal.submit(request, title, json)
  })

  return result;
})

fastify.get('/proposal/list', async (request, reply) => {
  const result = await request.pgpool.connect(async (connection) => {
    request.pgconn = connection
    request.auth = await auth(request)

    if (request.auth.error) {
      return {error: request.auth.error.message}
    }
    
    return await proposal.list(request)
  })

  return result;
})

fastify.post('/test', async (request, reply) => {
  const result = await request.pgpool.connect(async (connection) => {
    request.pgconn = connection
    request.auth = await auth(request)

    if (request.auth.error) {
      return {error: request.auth.error.message}
    }
    
    return await publishProposal(request)
  })

  return result;
})

const start = async () => {
  try {
    await fastify.listen(3001, '0.0.0.0')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()

/*
{
  "1":"external_id","true":"admin","false":"moderator","admin@testforum.gozel.com.tr":"email","trust_level_0,trust_level_1,admins,staff":"groups","e4e1789465974bd4e76caee41479b66c87a12ec3563447e1722d3b816e614d0ae7164895da8185a1b07e845d642fae1623bf6caec53a55d571c2b451dced1ec7":"nonce","https://gov-backend.onrender.com/discourse/signin/token":"return_sso_url","muratgozel":"username"
}
*/