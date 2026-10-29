-- CreateTable
CREATE TABLE "sign_in_code_budgets" (
    "user_id" UUID NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "codes_sent" INTEGER NOT NULL,

    CONSTRAINT "sign_in_code_budgets_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "sign_in_code_budgets" ADD CONSTRAINT "sign_in_code_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
