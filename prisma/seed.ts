import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  // --- Units ---
  const units = await Promise.all(
    [
      { name: "Chinchwad Unit-1", location: "Chinchwad, Pune", code: "CH1" },
      { name: "Chinchwad Unit-2", location: "Chinchwad, Pune", code: "CH2" },
      { name: "Savli Unit-3", location: "Savli, Vadodara", code: "SV3" },
    ].map((u) =>
      db.unit.upsert({ where: { code: u.code }, update: {}, create: u })
    )
  );
  const [ch1, ch2, sv3] = units;

  // --- Superadmin ---
  const superadmin = await db.user.upsert({
    where: { email: "fairtechindia@gmail.com" },
    update: {},
    create: {
      email: "fairtechindia@gmail.com",
      name: "Superadmin",
      role: "SUPERADMIN",
      passwordHash: await bcrypt.hash("fairtech@2026", 10),
    },
  });

  // --- Sample admin & supervisor (change/remove in production) ---
  await db.user.upsert({
    where: { email: "admin@fairtech.local" },
    update: {},
    create: {
      email: "admin@fairtech.local",
      name: "Demo Admin",
      role: "ADMIN",
      passwordHash: await bcrypt.hash("admin@2026", 10),
      units: { create: [{ unitId: ch1.id }, { unitId: ch2.id }] },
    },
  });
  await db.user.upsert({
    where: { email: "supervisor@fairtech.local" },
    update: {},
    create: {
      email: "supervisor@fairtech.local",
      name: "Demo Supervisor",
      role: "SUPERVISOR",
      passwordHash: await bcrypt.hash("super@2026", 10),
      units: { create: [{ unitId: ch1.id }] },
    },
  });

  // --- Sample employees ---
  const employeeData = [
    { name: "Ramesh Patil", code: "EMP001", skill: "Welder", unitId: ch1.id },
    { name: "Suresh Kadam", code: "EMP002", skill: "Fitter", unitId: ch1.id },
    { name: "Vijay Sharma", code: "EMP003", skill: "Helper", unitId: ch1.id },
    { name: "Anil Jadhav", code: "EMP004", skill: "Welder", unitId: ch2.id },
    { name: "Prakash More", code: "EMP005", skill: "Grinder", unitId: ch2.id },
    { name: "Dinesh Rathva", code: "EMP006", skill: "Fitter", unitId: sv3.id },
    { name: "Kiran Baria", code: "EMP007", skill: "Painter", unitId: sv3.id },
  ];
  for (const e of employeeData) {
    await db.employee.upsert({
      where: { code: e.code },
      update: {},
      create: {
        name: e.name,
        code: e.code,
        skill: e.skill,
        primaryUnitId: e.unitId,
        transfers: { create: { toUnitId: e.unitId } },
      },
    });
  }

  // --- Templates ---
  const tankTemplate = await db.jobTemplate.upsert({
    where: { name: "Transformer Tank Fabrication — Standard Process" },
    update: {},
    create: {
      name: "Transformer Tank Fabrication — Standard Process",
      description: "Standard stage sequence for transformer tanks",
      stages: {
        create: [
          "Marking & Cutting",
          "Edge Preparation",
          "Fit-up",
          "Welding",
          "Machining",
          "Testing (Leak/NDT)",
          "Shot Blasting",
          "Painting",
          "Final Inspection & Dispatch",
        ].map((name, i) => ({ name, sequence: i + 1 })),
      },
    },
  });
  await db.jobTemplate.upsert({
    where: { name: "Pressure Vessel — Standard Process" },
    update: {},
    create: {
      name: "Pressure Vessel — Standard Process",
      description: "Standard stage sequence for pressure vessels",
      stages: {
        create: [
          "Material Inspection",
          "Marking & Cutting",
          "Rolling",
          "Fit-up",
          "Welding",
          "Hydro Test",
          "Painting & Dispatch",
        ].map((name, i) => ({ name, sequence: i + 1 })),
      },
    },
  });

  // --- A sample job so the dashboard isn't empty ---
  const existingJob = await db.job.findFirst();
  if (!existingJob) {
    const due = new Date();
    due.setDate(due.getDate() + 45);
    const template = await db.jobTemplate.findUniqueOrThrow({
      where: { id: tankTemplate.id },
      include: { stages: { orderBy: { sequence: "asc" } } },
    });
    await db.job.create({
      data: {
        clientName: "Sample Client Ltd",
        poNumber: "PO-2026-001",
        description: "Transformer Tank 25MVA",
        unitId: ch1.id,
        expectedCompletion: due,
        createdById: superadmin.id,
        templateId: template.id,
        stages: {
          create: template.stages.map((s) => ({
            name: s.name,
            description: s.description,
            sequence: s.sequence,
          })),
        },
      },
    });
  }

  console.log("Seed complete.");
  console.log("Superadmin login: fairtechindia@gmail.com / fairtech@2026");
  console.log("Demo admin: admin@fairtech.local / admin@2026");
  console.log("Demo supervisor: supervisor@fairtech.local / super@2026");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
