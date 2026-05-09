// /src/routes/cron.js
import express from "express";
import { prisma } from "../lib/db.js";

const cronRouter = express.Router();

cronRouter.post("/cleanup", async (req, res) => {
    // 🔐 simple protection
    if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
        return res.status(401).send("unauthorized");
    }

    try {
        const result = await prisma.withdrawalRequest.deleteMany({
            where: {
                resolvedAt: {
                    lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
                }
            }
        });

        console.log("Cleanup run:", result.count);

        res.json({ success: true, deleted: result.count });
    } catch (err) {
        console.error("Cleanup failed:", err);
        res.status(500).send("error");
    }
});

// cronRouter.post("/cleanup", async (req, res) => {
//     if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
//         return res.status(401).send("unauthorized");
//     }
//
//     try {
//         const threshold = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
//
//         const all = await prisma.withdrawalRequest.findMany({
//             select: {
//                 id: true,
//                 status: true,
//                 resolvedAt: true,
//                 customerEmail: true,
//             },
//         });
//
//         const eligible = await prisma.withdrawalRequest.findMany({
//             where: {
//                 resolvedAt: {
//                     lt: threshold,
//                 },
//             },
//             select: {
//                 id: true,
//                 status: true,
//                 resolvedAt: true,
//                 customerEmail: true,
//             },
//         });
//
//         const result = await prisma.withdrawalRequest.deleteMany({
//             where: {
//                 resolvedAt: {
//                     lt: threshold,
//                 },
//             },
//         });
//
//         console.log("Cleanup threshold:", threshold);
//         console.log("All requests:", all);
//         console.log("Eligible requests:", eligible);
//         console.log("Deleted:", result.count);
//
//         res.json({
//             success: true,
//             threshold,
//             allCount: all.length,
//             eligibleCount: eligible.length,
//             eligible,
//             deleted: result.count,
//         });
//     } catch (err) {
//         console.error("Cleanup failed:", err);
//         res.status(500).json({
//             success: false,
//             error: err.message,
//         });
//     }
// });

export default cronRouter;