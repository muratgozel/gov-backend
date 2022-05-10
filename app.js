const {randomBytes, createHmac} = require('crypto')
const {URLSearchParams} = require('url')
const Redis = require("ioredis")
const fastify = require('fastify')({ logger: true })
fastify.register(require('@fastify/sensible'))

fastify.addHook('onRequest', async (request, reply) => {
  request.redis = new Redis(process.env.REDIS_CONN_STR)
})

fastify.get('/', async (request, reply) => {
  return { hello: 'world' }
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
  const nonce2 = await request.redis.get(`discourse:signin:${params.get('nonce')}`)

  if (params.get('nonce') != nonce2) {
    return reply.badRequest('Nonce mismatch.')
  }

  const signature = createHmac('sha256', process.env.DISCOURSE_SSO_SECRET).update(request.query.sso).digest('hex')

  if (Buffer.from(signature).equals(Buffer.from(request.query.sig)) !== true) {
    return reply.badRequest('Signature mismatch.')
  }

  const userParams = {}
  params.forEach((n, v) => {userParams[n] = v})

  return {params: userParams}
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
