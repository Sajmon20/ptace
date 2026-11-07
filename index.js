import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } from 'discord.js';
import cron from 'node-cron';
import axios from 'axios';
import readline from 'readline';
import { db, ref, get, set, update, remove } from './firebase.js';
import dotenv from 'dotenv';
dotenv.config();

const OWNER_ID = "870947170407313418";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

// Pomocná funkce pro získání dnešního svátku v ČR
async function getTodayHoliday() {
  try {
    const res = await axios.get('https://api.abalin.net/today?country=cz');
    if (res.data && res.data.data && res.data.data.name_cz) {
      return res.data.data.name_cz;
    }
  } catch (e) {
    console.error("Chyba při stahování svátků:", e.message);
  }
  return "Neznámý svátek";
}

// Pomocná funkce pro počasí
async function getWeather(city = "Opava") {
  try {
    const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t`, { responseType: 'text' });
    return res.data.trim();
  } catch (e) {
    return "Nepodařilo se načíst počasí";
  }
}

client.once('ready', async () => {
  console.log(`🤖 Bot ${client.user.tag} je online a připraven!`);

  // Registrace slash příkazů
  const commands = [
    new SlashCommandBuilder()
      .setName('odber')
      .setDescription('Přihlásit se nebo odhlásit z ranního zpravodaje')
      .addStringOption(option =>
        option.setName('mesto')
          .setDescription('Zadej své město pro předpověď počasí (např. Opava)')
          .setRequired(true)
      ),
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash příkazy registrovány.');
  } catch (error) {
    console.error(error);
  }

  startConsole();
});

// Zpracování slash příkazů a tlačítek
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'odber') {
      const city = interaction.options.getString('mesto');
      const userId = interaction.user.id;
      const userRef = ref(db, `subscribers/${userId}`);
      
      const snapshot = await get(userRef);
      if (snapshot.exists()) {
        // Pokud už existuje, odhlásíme ho (nebo aktualizujeme město)
        await remove(userRef);
        await interaction.reply({ content: '🔕 Tvůj odběr Ranního ptáčete byl **zrušen**.', ephemeral: true });
      } else {
        await set(userRef, { city, active: true, username: interaction.user.tag });
        await interaction.reply({ content: `🔔 Úspěšně přihlášeno! Každé ráno ti pošlu přehled pro město **${city}**.`, ephemeral: true });
      }
    }
  }
});

// ⏰ Ranní cron – spouští se každé ráno v 6:00
cron.schedule('0 6 * * *', async () => {
  console.log('🌅 Spouštím ranní rozesílku Ranního ptáčete...');
  const snapshot = await get(ref(db, 'subscribers'));
  if (!snapshot.exists()) return;

  const subscribers = snapshot.val();
  const holiday = await getTodayHoliday();

  for (const [userId, data] of Object.entries(subscribers)) {
    if (!data.active) continue;

    try {
      const weather = await getWeather(data.city || 'Opava');
      
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🌅 Dobré ráno, Ranní ptáče!')
        .setDescription('Tady je tvůj pravidelný přehled do nového dne.')
        .addFields(
          { name: '📅 Dnes má svátek', value: `**${holiday}**`, inline: false },
          { name: `⛅ Počasí (${data.city || 'Opava'})`, value: weather, inline: false },
          { name: '💡 Dnešní zajímavost', value: 'Věděl jsi, že pravidelný ranní režim zvyšuje produktivitu během dne až o 30 %?', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Ranní ptáče • Správa příkazem /odber' });

      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed] });
    } catch (err) {
      console.error(`Nepodařilo se odeslat zprávu uživateli ${userId}:`, err.message);
    }
  }
  console.log('✨ Ranní rozesílka dokončena.');
});

// 🛠️ Vlastní terminálová konzole pro majitele
function startConsole() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🛠️  Ranní ptáče Admin Konzole aktivní.');
  console.log('Dostupné příkazy: stats, list, broadcast <zpráva>, exit\n');
  process.stdout.write('> ');

  rl.on('line', async (line) => {
    const args = line.trim().split(' ');
    const cmd = args[0];

    if (cmd === 'stats') {
      const snap = await get(ref(db, 'subscribers'));
      const count = snap.exists() ? Object.keys(snap.val()).length : 0;
      console.log(`📊 Celkem registrovaných odběratelů: ${count}`);
    } else if (cmd === 'list') {
      const snap = await get(ref(db, 'subscribers'));
      console.log('👥 Seznam uživatelů:', snap.exists() ? snap.val() / / Žádní uživatelé);
    } else if (cmd === 'broadcast') {
      const msg = args.slice(1).join(' ');
      if (!msg) {
        console.log('❌ Zadej text zprávy!');
      } else {
        const snap = await get(ref(db, 'subscribers'));
        if (snap.exists()) {
          for (const userId of Object.keys(snap.val())) {
            try {
              const u = await client.users.fetch(userId);
              await u.send(`📢 **Hlášení od majitele:** ${msg}`);
            } catch (e) {}
          }
          console.log('📢 Hromadná zpráva rozeslána.');
        }
      }
    } else if (cmd === 'exit') {
      console.log('Ukončuji...');
      process.exit(0);
    } else {
      console.log('Neznámý příkaz. Zkus: stats, list, broadcast <text>, exit');
    }

    process.stdout.write('> ');
  });
}

client.login(process.env.DISCORD_TOKEN);
