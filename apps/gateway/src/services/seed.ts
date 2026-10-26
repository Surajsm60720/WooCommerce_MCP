import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { refreshServerStatus, slugify } from "./servers.js";

async function upsertUser(
  email: string,
  name: string,
  password: string,
  role: "admin" | "member",
) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role },
    update: { name, passwordHash, role },
  });
}

async function upsertServer(name: string, url: string) {
  const slug = slugify(name);
  return prisma.mcpServer.upsert({
    where: { slug },
    create: {
      name,
      slug,
      url,
      credentialType: "none",
      enabled: true,
      status: "unreachable",
    },
    update: { name, url },
  });
}

export async function seed() {
  await upsertUser(
    config.seed.adminEmail,
    config.seed.adminName,
    config.seed.adminPassword,
    "admin",
  );
  await upsertUser(
    config.seed.memberEmail,
    config.seed.memberName,
    config.seed.memberPassword,
    "member",
  );

  const woo = await upsertServer("WooCommerce", config.seed.wooMcpUrl);
  const time = await upsertServer("Time", config.seed.timeMcpUrl);
  const notes = await upsertServer("Notes", config.seed.notesMcpUrl);

  // Probe in background-friendly sequential order so seed doesn't hang forever
  for (const s of [woo, time, notes]) {
    try {
      await refreshServerStatus(s.id);
    } catch (err) {
      console.warn(`Seed probe failed for ${s.slug}:`, err);
    }
  }

  console.log(
    `Seeded personas: Ava (${config.seed.adminEmail}), Ben (${config.seed.memberEmail})`,
  );
}
