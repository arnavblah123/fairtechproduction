import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const db = new PrismaClient();

async function main() {
  // --- One-time rename (guarded): Chinchwad Unit-2 became Dehu Unit-2.
  // Must run before the unit upserts so the existing CH2 row is renamed in
  // place instead of a duplicate DH2 unit being created.
  const renameKey = "patch.2026-07-17.ch2-renamed-dehu";
  if (!(await db.setting.findUnique({ where: { key: renameKey } }))) {
    const old = await db.unit.findUnique({ where: { code: "CH2" } });
    if (old) {
      await db.unit.update({
        where: { id: old.id },
        data: { name: "Dehu Unit-2", location: "Dehu, Pune", code: "DH2" },
      });
      console.log("Patch: renamed Chinchwad Unit-2 to Dehu Unit-2 (DH2).");
    }
    await db.setting.create({ data: { key: renameKey, value: "done" } });
  }

  // --- Units ---
  const units = await Promise.all(
    [
      { name: "Chinchwad Unit-1", location: "Chinchwad, Pune", code: "CH1" },
      { name: "Dehu Unit-2", location: "Dehu, Pune", code: "DH2" },
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

  // --- One-time data patch (guarded by a Setting flag so it never reruns):
  // the "U2" salary sheet was actually the Savli Unit-3 roster, so employees
  // imported as U2-xx into Chinchwad Unit-2 belong in Savli Unit-3 as U3-xx.
  const patchKey = "patch.2026-07-17.u2-roster-is-savli";
  const patched = await db.setting.findUnique({ where: { key: patchKey } });
  if (!patched) {
    const misfiled = await db.employee.findMany({
      where: { code: { startsWith: "U2-" }, primaryUnitId: ch2.id },
    });
    for (const emp of misfiled) {
      await db.$transaction([
        db.employee.update({
          where: { id: emp.id },
          data: {
            code: emp.code.replace(/^U2-/, "U3-"),
            primaryUnitId: sv3.id,
          },
        }),
        // The unit was wrong from day one — correct the open membership
        // record rather than logging a fake transfer.
        db.unitTransfer.updateMany({
          where: { employeeId: emp.id, toDate: null, toUnitId: ch2.id },
          data: { toUnitId: sv3.id },
        }),
      ]);
    }
    await db.setting.create({ data: { key: patchKey, value: "done" } });
    if (misfiled.length > 0) {
      console.log(`Patch: moved ${misfiled.length} employees from Unit-2 to Savli Unit-3.`);
    }
  }

  // --- Real employees (prisma/import/employees.json, extracted from the
  // unit muster registers). Idempotent: existing codes are left untouched,
  // so renames/transfers made in the app are never overwritten.
  const importFile = path.join(__dirname, "import", "employees.json");
  if (fs.existsSync(importFile)) {
    const roster: { code: string; name: string; skill: string; unitCode: string }[] =
      JSON.parse(fs.readFileSync(importFile, "utf8"));
    const unitByCode = new Map(units.map((u) => [u.code, u]));
    let added = 0;
    for (const e of roster) {
      const unit = unitByCode.get(e.unitCode);
      if (!unit) continue;
      const existing = await db.employee.findUnique({ where: { code: e.code } });
      if (existing) continue;
      await db.employee.create({
        data: {
          name: e.name,
          code: e.code,
          skill: e.skill,
          primaryUnitId: unit.id,
          transfers: { create: { toUnitId: unit.id } },
        },
      });
      added++;
    }
    console.log(`Employee import: ${added} added, ${roster.length - added} already present.`);
  }

  // Retire the old demo employees, but only if they were never used.
  for (let i = 1; i <= 7; i++) {
    const code = `EMP${String(i).padStart(3, "0")}`;
    const demo = await db.employee.findUnique({
      where: { code },
      include: { _count: { select: { timeLogs: true } } },
    });
    if (demo && demo.active && demo._count.timeLogs === 0) {
      await db.employee.update({ where: { id: demo.id }, data: { active: false } });
    }
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
