import express from "express";
import {
  getTagCommits,
  getAvailableRefs,
  syncRepository,
  fetchCommitHistory,
} from "./github.controller.js";
const router = express.Router();

router.post("/list", getTagCommits);
router.post("/refs", getAvailableRefs);
router.post("/history", fetchCommitHistory);
router.post("/clone", syncRepository);
export default router;
