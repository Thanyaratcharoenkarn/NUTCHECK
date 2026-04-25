# Deploy NutCheck

## Option 1: Railway

เหมาะถ้าอยาก deploy จาก GitHub เร็ว และใช้ SQLite ต่อได้ด้วย Volume

1. Push โปรเจกต์นี้ขึ้น GitHub
2. ไปที่ Railway แล้วเลือก `New Project`
3. เลือก `Deploy from GitHub repo`
4. เลือก repo `NUTCHECK`
5. หลัง deploy เสร็จ ให้เพิ่ม Volume
6. ตั้ง mount path เป็น `/app/data`
7. เปิดโดเมนสาธารณะจาก Railway

ตัวแอปจะอ่านฐานข้อมูลจาก:

`/app/data/attendance.db`

## Option 2: Render

เหมาะถ้าอยากได้ config ผ่าน `render.yaml`

1. Push โปรเจกต์นี้ขึ้น GitHub
2. ไปที่ Render แล้วเลือก `New +`
3. เลือก `Blueprint`
4. เลือก repo `NUTCHECK`
5. Render จะอ่าน `render.yaml` ให้อัตโนมัติ

ตัวแอปจะอ่านฐานข้อมูลจาก:

`/opt/render/project/src/data/attendance.db`

## Notes

- ถ้าไม่มี persistent disk/volume, SQLite จะหายเมื่อ redeploy
- backend ถูกตั้งให้ bind ที่ `0.0.0.0` แล้ว
- port ใช้จาก `process.env.PORT`
