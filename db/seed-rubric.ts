import { dbClient, dbConn } from "@db/client.js";
import { RUBRIC } from "@db/rubric.js";
import { questionsTable } from "@db/schema.js";
import { eq } from "drizzle-orm";

// ใส่/อัปเดตเฉพาะชุดคำถาม ไม่แตะข้อมูลอื่น รันซ้ำได้ — จับคู่ด้วยลำดับข้อ และไม่ลบข้อเดิม (คะแนนที่ส่งแล้วอ้างถึงอยู่)
async function main() {
  let inserted = 0;
  let updated = 0;
  await dbClient.transaction(async (tx) => {
    for (const question of RUBRIC) {
      const [existing] = await tx
        .select({ id: questionsTable.id, type: questionsTable.type })
        .from(questionsTable)
        .where(eq(questionsTable.orderNo, question.orderNo));
      if (!existing) {
        await tx.insert(questionsTable).values(question);
        inserted++;
      } else if (existing.type !== question.type) {
        // เปลี่ยนชนิดข้อที่มีคำตอบแล้วจะทำให้คำตอบเดิมผิดความหมาย
        throw new Error(`ข้อ ${question.orderNo} ในฐานข้อมูลเป็น ${existing.type} แต่รูบริกเป็น ${question.type} — ไม่แก้ให้อัตโนมัติ`);
      } else {
        await tx.update(questionsTable).set(question).where(eq(questionsTable.id, existing.id));
        updated++;
      }
    }
  });
  console.log(`Rubric seeded: ${inserted} inserted, ${updated} updated`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => dbConn.end());
