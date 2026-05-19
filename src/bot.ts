import { Telegraf } from 'telegraf'
import { findUserByToken, findUserByChatId, linkUser, unlinkUser } from './db'
import { T, getLang } from './messages'

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token)

  // /start — with or without a link token
  bot.start(async (ctx) => {
    const payload = ctx.startPayload?.trim()

    if (!payload) {
      // No token — show onboarding hint in English (we don't know their language yet)
      return ctx.reply(T.noToken.en, { parse_mode: 'Markdown' })
    }

    const user = await findUserByToken(payload)

    if (!user) {
      return ctx.reply(T.invalidToken.en, { parse_mode: 'Markdown' })
    }

    const lang = getLang(user.langCode)

    if (user.telegramChatId !== null) {
      // Already linked to some Telegram — reject linking again (security)
      return ctx.reply(T.alreadyLinked[lang], { parse_mode: 'Markdown' })
    }

    await linkUser(user.id, user.role, BigInt(ctx.from.id))

    return ctx.reply(T.welcome[lang](user.name), { parse_mode: 'Markdown' })
  })

  // /unlink — removes Telegram connection
  bot.command('unlink', async (ctx) => {
    const chatId = BigInt(ctx.from.id)
    const user = await findUserByChatId(chatId)

    if (!user) {
      return ctx.reply(T.notLinked.en, { parse_mode: 'Markdown' })
    }

    await unlinkUser(user.id, user.role)
    return ctx.reply(T.unlinked.en, { parse_mode: 'Markdown' })
  })

  // Fallback for any other message
  bot.on('message', async (ctx) => {
    const chatId = BigInt(ctx.from.id)
    const user = await findUserByChatId(chatId)
    const lang = user ? getLang('ru') : 'en' // default to Russian if linked, else English

    return ctx.reply(T.noToken[lang], { parse_mode: 'Markdown' })
  })

  return bot
}
