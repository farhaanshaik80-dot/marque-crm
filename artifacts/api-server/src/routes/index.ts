import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marqueRouter from "./marque";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marqueRouter);

export default router;
