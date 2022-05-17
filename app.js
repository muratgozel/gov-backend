const {randomBytes, createHmac} = require('crypto')
const {URLSearchParams} = require('url')
const {createPool} = require('slonik')
const pgpool = createPool(process.env.PG_CONN_STR)
const Redis = require('ioredis')
const redis = new Redis(process.env.REDIS_CONN_STR)
const fastify = require('fastify')({ logger: true })
fastify.register(require('@fastify/sensible'))
const {signinWithDiscourse} = require('./nodes/signin')
const {sessionInfo} = require('./nodes/session')

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
})

fastify.get('/', async (request, reply) => {
  return {}
})

fastify.get('/session', async (request, reply) => {
  const token = (request.headers.authorization || '').replace('Bearer ', '')
  console.log({token: token})
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