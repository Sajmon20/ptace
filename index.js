import { 
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, 
  ModalBuilder, TextInputBuilder, TextInputStyle 
} from 'discord.js';
import cron from 'node-cron';
import axios from 'axios';
import { db, ref, get, set, remove } from './firebase.js';
import dotenv from 'dotenv';
dotenv.config();

const OWNER_ID = "870947170407313418";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

// Pomocná funkce pro svátky v ČR
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

// Funkce pro ranní rozesílku
async function sendMorningNews() {
  const snapshot = await get(ref(db, 'subscribers'));
  if (!snapshot.exists()) return;

  const subscribers = snapshot.val();
  const holiday = await getTodayHoliday();

  for (const [userId, data] of Object.entries(subscribers)) {
    if (!data.active) continue;

    try {
      const city = data.city || 'Opava';
      const weather = await getWeather(city);
      
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🌅 Dobré ráno, Ranní ptáče!')
        .setDescription('Tady je tvůj pravidelný ranní přehled do nového dne.')
        .addFields(
          { name: '📅 Dnes má svátek', value: `**${holiday}**`, inline: false },
          { name: `⛅ Počasí (${city})`, value: weather, inline: false },
          { name: '💡 Dnešní zajímavost', value: 'Věděl jsi, že pravidelný ranní režim zvyšuje produktivitu během dne až o 30 %?', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Ranní ptáče • Váš ranní průvodce' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('unsub_btn')
          .setLabel('Zrušit odběr')
          .setStyle(ButtonStyle.Danger)
      );

      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error(`Nepodařilo se poslat zprávu uživateli ${userId}:`, err.message);
    }
  }
}

client.once('ready', async () => {
  console.log(`🤖 Bot ${client.user.tag} je online!`);

  // Registrace slash příkazů
  const commands = [
    new SlashCommandBuilder()
      .setName('adminpanel')
      .setDescription('Otevře administrátorský panel bota (pouze majitel)'),
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Odešle interaktivní panel pro odběratele do tohoto kanálu')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash příkazy registrovány.');
  } catch (error) {
    console.error(error);
  }
});

// Zpracování interakcí (Slash příkazy, Tlačítka, Modals)
client.on('interactionCreate', async interaction => {
  try {
    // 1. Slash příkazy
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'adminpanel') {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: '❌ Tento příkaz může používat pouze majitel bota.', ephemeral: true });
        }

        const adminEmbed = new EmbedBuilder()
          .setColor('#2b2d31')
          .setTitle('🛠️ Ranní ptáče – Admin Panel')
          .setDescription('Vítej v administraci bota. Zde můžeš spravovat nastavení a testovat rozesílku.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('admin_stats')
            .setLabel('📊 Statistiky')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('admin_test')
            .setLabel('🧪 Test rozesílky')
            .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [adminEmbed], components: [row], ephemeral: true });
      }

      if (interaction.commandName === 'setup') {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: '❌ Pouze majitel může nastavit odběrový kanál.', ephemeral: true });
        }

        const publicEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('🌅 Ranní ptáče – Odběr novinek')
          .setDescription('Chceš každé ráno dostávat do DM přehled svátků, počasí a zajímavostí?\n\nStiskni tlačítko níže a přihlas se k odběru!');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_sub_modal')
            .setLabel('🔔 Přihlásit se k odběru')
            .setStyle(ButtonStyle.Success)
        );

        await interaction.channel.send({ embeds: [publicEmbed], components: [row] });
        return interaction.reply({ content: '✅ Odběrový panel byl úspěšně odeslán do tohoto kanálu!', ephemeral: true });
      }
    }

    // 2. Kliknutí na tlačítka
    if (interaction.isButton()) {
      if (interaction.customId === 'open_sub_modal') {
        // Otevření modálního okna pro zadání města
        const modal = new ModalBuilder()
          .setCustomId('sub_modal')
          .setTitle('Nastavení odběru Ranního ptáčete');

        const cityInput = new TextInputBuilder()
          .setCustomId('city_input')
          .setLabel('Tvoje město (pro počasí):')
          .setPlaceholder('např. Opava')
          .setStyle(TextInputStyle.Short)
          .setRequired(false); // Nepovinné

        modal.addComponents(new ActionRowBuilder().addComponents(cityInput));
        return await interaction.showModal(modal);
      }

      if (interaction.customId === 'unsub_btn') {
        const userRef = ref(db, `subscribers/${interaction.user.id}`);
        await remove(userRef);
        return interaction.reply({ content: '🔕 Tvůj odběr byl úspěšně zrušen.', ephemeral: true });
      }

      if (interaction.customId === 'admin_stats') {
        if (interaction.user.id !== OWNER_ID) return;
        const snap = await get(ref(db, 'subscribers'));
        const count = snap.exists() ? Object.keys(snap.val()).length : 0;
        return interaction.reply({ content: `📊 Aktuální počet odběratelů: **${count}**`, ephemeral: true });
      }

      if (interaction.customId === 'admin_test') {
        if (interaction.user.id !== OWNER_ID) return;
        await interaction.reply({ content: '🧪 Spouštím testovací ranní rozesílku...', ephemeral: true });
        await sendMorningNews();
      }
    }

    // 3. Odeslání modálního okna (zpracování města)
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'sub_modal') {
        let city = interaction.fields.getTextInputValue('city_input').trim();
        if (!city) city = "Opava"; // Výchozí, pokud nevyplní

        const userId = interaction.user.id;
        const userRef = ref(db, `subscribers/${userId}`);

        await set(userRef, {
          city: city,
          active: true,
          username: interaction.user.tag
        });

        return interaction.reply({
          content: `✅ Úspěšně přihlášeno k odběru!\nKaždé ráno ti pošlu ranní zprávu s počasím pro město **${city}**.\n*(Město nikde nesdílíme, slouží čistě pro generování počasí).*`,
          ephemeral: true
        });
      }
    }
  } catch (err) {
    console.error("Chyba při zpracování interakce:", err);
  }
});

// ⏰ Automatický cron – každé ráno v 6:00
cron.schedule('0 6 * * *', async () => {
  await sendMorningNews();
});

client.login(process.env.DISCORD_TOKEN);
