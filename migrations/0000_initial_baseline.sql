-- Required by vector(1024) columns and HNSW indexes below.
-- Supabase enables this by default; bare Postgres / fresh RDS needs it.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "analyst_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar NOT NULL,
	"analyst" text NOT NULL,
	"source" text NOT NULL,
	"date" text,
	"title" text,
	"url" text,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
--> statement-breakpoint
CREATE TABLE "analyst_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analyst" text NOT NULL,
	"source" text NOT NULL,
	"url" text,
	"date" text,
	"title" text,
	"body" text NOT NULL,
	"type" text,
	"tags" text[] DEFAULT '{}'::text[],
	"file_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analyst_documents_file_path_unique" UNIQUE("file_path")
);
--> statement-breakpoint
CREATE TABLE "analyst_frameworks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analyst" text NOT NULL,
	"framework_slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"versions" jsonb NOT NULL,
	"version_count" integer DEFAULT 1 NOT NULL,
	"first_seen_date" text,
	"last_seen_date" text,
	"embedding" vector(1024) NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || description)) STORED
);
--> statement-breakpoint
CREATE TABLE "benchmark_case_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"case_id" varchar NOT NULL,
	"score" double precision NOT NULL,
	"magnitude_ratio" double precision,
	"trend_match" boolean,
	"mape" double precision,
	"execution_success" boolean NOT NULL,
	"sanity_passed" boolean,
	"data_source" text,
	"sql_used" text,
	"error_message" text,
	"latency_ms" integer,
	"llm_calls" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_cases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol" text NOT NULL,
	"metric_type" text NOT NULL,
	"reference_source" text NOT NULL,
	"natural_language_query" text NOT NULL,
	"reference_fetcher" text NOT NULL,
	"tolerance" double precision DEFAULT 0.2 NOT NULL,
	"difficulty" text DEFAULT 'standard' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"protocol_slug" text,
	"protocol_category" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_quality_cases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dimension" text NOT NULL,
	"prompt" text NOT NULL,
	"rubric" text NOT NULL,
	"expected_behavior" text,
	"tags" jsonb,
	"prior_turns" jsonb,
	"criteria" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_quality_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"case_id" varchar NOT NULL,
	"dimension" text NOT NULL,
	"score" double precision NOT NULL,
	"verdict" text,
	"critique" text,
	"response_text" text,
	"response_artifacts" jsonb,
	"judge_raw" jsonb,
	"criteria_scores" jsonb,
	"failed_criteria_ids" text[],
	"follow_up_prompt" text,
	"follow_up_response" text,
	"follow_up_cost" double precision,
	"follow_up_latency_ms" integer,
	"cost_usd" double precision,
	"latency_ms" integer,
	"execution_success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_quality_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"total_cases" integer NOT NULL,
	"scored_cases" integer DEFAULT 0 NOT NULL,
	"average_score" double precision,
	"total_cost_usd" double precision,
	"total_latency_ms" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"judge_model" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_version" integer NOT NULL,
	"total_cases" integer NOT NULL,
	"passed_cases" integer NOT NULL,
	"failed_cases" integer NOT NULL,
	"overall_accuracy" double precision NOT NULL,
	"total_cost_usd" double precision,
	"total_latency_ms" integer,
	"config_snapshot" jsonb,
	"improvements_applied" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_entities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"entity_name" text NOT NULL,
	"type" text DEFAULT 'unknown' NOT NULL,
	"category" text,
	"summary" text,
	"embedding" vector(1024) NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', entity_name || ' ' || COALESCE(summary, '') || ' ' || type)) STORED,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_facts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"fact" text NOT NULL,
	"entities" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"date" text,
	"confidence" text DEFAULT 'verified' NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', topic || ' ' || fact)) STORED,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_aggregations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"metric_name" text NOT NULL,
	"description" text NOT NULL,
	"required_sources" jsonb NOT NULL,
	"aggregation_method" text DEFAULT 'sum' NOT NULL,
	"notes" text,
	"source_msg_id" integer,
	"source" text DEFAULT 'seed' NOT NULL,
	"confidence" integer DEFAULT 80 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"one_liner" text NOT NULL,
	"description" text,
	"sector" text,
	"sub_sector" text,
	"business_model" text,
	"stage" text,
	"funding_history" text,
	"competitive_landscape" text,
	"source_url" text,
	"website_url" text,
	"github_url" text,
	"twitter_url" text,
	"linkedin_url" text,
	"pipeline_stage" text DEFAULT 'discovered' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[],
	"image_url" text,
	"excitement_score" integer,
	"excitement_reason" text,
	"adjacent_reads" text,
	"has_liquid_token" boolean DEFAULT false,
	"token_tier" text,
	"token_ticker" text,
	"token_contract_address" text,
	"token_chain" text,
	"liquid_token_analysis" text,
	"deleted_report_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" integer NOT NULL,
	"prev_assistant_msg_id" integer NOT NULL,
	"user_msg_id" integer NOT NULL,
	"status" text DEFAULT 'awaiting_corrected_turn' NOT NULL,
	"corrected_assistant_msg_id" integer,
	"processed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_alert_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_threshold" double precision DEFAULT 5 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"telegram_enabled" boolean DEFAULT false NOT NULL,
	"last_alert_date" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_charts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"chart_type" text DEFAULT 'line' NOT NULL,
	"data_source" text NOT NULL,
	"data_source_config" text NOT NULL,
	"chart_config" text NOT NULL,
	"data" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"error_message" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_source_facts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"scope_ref" text NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"confidence" text NOT NULL,
	"source_of_fact" text NOT NULL,
	"observed_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"stale_at" timestamp,
	"dedupe_key" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
	CONSTRAINT "data_source_facts_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "dune_queries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"query_id" integer NOT NULL,
	"label" text NOT NULL,
	"visualization_type" text DEFAULT 'table' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"master_query_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_models" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"source_message_id" integer,
	"source_conversation_id" integer,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"bio" text,
	"linkedin_url" text,
	"twitter_url" text,
	"github_url" text,
	"personal_url" text,
	"prior_companies" text
);
--> statement-breakpoint
CREATE TABLE "master_dune_queries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_id" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text,
	"protocol_tags" text[] DEFAULT '{}',
	"chain_tags" text[] DEFAULT '{}',
	"visualization_type" text DEFAULT 'table' NOT NULL,
	"source_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_dune_queries_query_id_unique" UNIQUE("query_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "output_requirements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_shape" text NOT NULL,
	"entity" text DEFAULT '*' NOT NULL,
	"title" text NOT NULL,
	"requirement" text NOT NULL,
	"ordering" integer DEFAULT 100 NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_knowledge" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" text,
	"protocol_type" text,
	"primary_chain" text,
	"chains" jsonb,
	"tvl" double precision,
	"tvl_rank" integer,
	"gecko_id" text,
	"symbol" text,
	"has_fee_data" boolean DEFAULT false,
	"has_revenue_data" boolean DEFAULT false,
	"has_dex_volume_data" boolean DEFAULT false,
	"fees_24h" double precision,
	"revenue_24h" double precision,
	"dune_spellbook_coverage" jsonb,
	"dune_project_name" text,
	"last_crawled_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_knowledge_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "protocol_revenue_models" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol" text NOT NULL,
	"protocol_slug" text,
	"protocol_type" text NOT NULL,
	"revenue_sources" jsonb NOT NULL,
	"key_contracts" jsonb NOT NULL,
	"fee_structure" text,
	"suggested_dune_tables" jsonb,
	"existing_dune_query_ids" jsonb,
	"revenue_sql_draft" text,
	"validation_status" text DEFAULT 'unvalidated' NOT NULL,
	"validation_score" double precision,
	"validation_error" text,
	"coingecko_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proven_queries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol" text NOT NULL,
	"metric_type" text NOT NULL,
	"sql_query" text NOT NULL,
	"data_source" text DEFAULT 'dune-sql' NOT NULL,
	"chart_type" text,
	"chart_config" jsonb,
	"x_axis_key" text,
	"y_axis_key" text,
	"y_axis_label" text,
	"y_axis_format" text,
	"success_count" integer DEFAULT 1 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"embedding" vector(1024),
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', protocol || ' ' || metric_type || ' ' || COALESCE(left(sql_query, 2000), ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "query_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"protocol" text NOT NULL,
	"metric_type" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"data_source" text NOT NULL,
	"sql_query" text,
	"error_type" text,
	"error_message" text,
	"sample_rows" jsonb,
	"final_outcome" text NOT NULL,
	"llm_model" text,
	"latency_ms" integer,
	"was_cache_hit" boolean DEFAULT false,
	"cross_validation_status" text,
	"cross_validation_ratio" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_model" text NOT NULL,
	"description" text,
	"sql_template" text NOT NULL,
	"required_params" jsonb NOT NULL,
	"output_metrics" jsonb NOT NULL,
	"example_protocol" text,
	"saved_query_dependencies" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_charts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" varchar NOT NULL,
	"chart_id" varchar NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content" text,
	"source_conversation_id" integer,
	"source_message_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_audit_findings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"phase" text NOT NULL,
	"test_name" text NOT NULL,
	"severity" text NOT NULL,
	"verdict" text NOT NULL,
	"prompt_text" text NOT NULL,
	"response_text" text,
	"score_reason" text,
	"cost_usd" text DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_audit_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"budget_usd" text DEFAULT '5.0' NOT NULL,
	"total_spent_usd" text DEFAULT '0' NOT NULL,
	"phases_enabled" text[] DEFAULT ARRAY['recon','prompt_extraction','data_exfil','cross_tenant','output_analysis']::text[] NOT NULL,
	"summary" jsonb,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_learnings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_key" text NOT NULL,
	"rule_type" text NOT NULL,
	"rule_text" text NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"triggered_by" text,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_analyses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"dune_data" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contract_address" text NOT NULL,
	"chain" text DEFAULT 'ethereum' NOT NULL,
	"token_ticker" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_arg_overrides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"arg_name" text NOT NULL,
	"from_value" text NOT NULL,
	"to_value" text NOT NULL,
	"source_msg_id" integer,
	"confidence" integer DEFAULT 80 NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"amount" text NOT NULL,
	"api_cost" text,
	"company_name" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"tx_hash" text,
	"status" text DEFAULT 'success' NOT NULL,
	"cost_basis" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"event" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_id" text,
	"wallet_address" text,
	"email" text,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" text,
	"subscription_status" text,
	"subscription_id" text,
	"subscription_period_end" timestamp,
	"telegram_chat_id" text,
	CONSTRAINT "users_privy_id_unique" UNIQUE("privy_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "chart_validations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"conversation_id" integer,
	"message_id" integer,
	"chart_title" text,
	"ok" boolean NOT NULL,
	"shipped" boolean DEFAULT true NOT NULL,
	"confidence" text NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"referee_model" text,
	"tier1_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tier2_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tier3_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grounded_fact_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"series_stats" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"title" text NOT NULL,
	"type" text DEFAULT 'chat' NOT NULL,
	"share_token" text,
	"parent_session_id" integer,
	"spawn_source" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"artifacts" jsonb,
	"kind" text,
	"plan" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_brains" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relationships" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contradictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "research_brains_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyst_chunks_embedding_idx" ON "analyst_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "analyst_chunks_analyst_idx" ON "analyst_chunks" USING btree ("analyst");--> statement-breakpoint
CREATE INDEX "analyst_chunks_document_idx" ON "analyst_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analyst_chunks_doc_chunk_unique" ON "analyst_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "analyst_documents_analyst_idx" ON "analyst_documents" USING btree ("analyst");--> statement-breakpoint
CREATE INDEX "analyst_documents_date_idx" ON "analyst_documents" USING btree ("date");--> statement-breakpoint
CREATE INDEX "analyst_frameworks_embedding_idx" ON "analyst_frameworks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "analyst_frameworks_analyst_idx" ON "analyst_frameworks" USING btree ("analyst");--> statement-breakpoint
CREATE UNIQUE INDEX "analyst_frameworks_analyst_slug_unique" ON "analyst_frameworks" USING btree ("analyst","framework_slug");--> statement-breakpoint
CREATE INDEX "brain_entities_embedding_idx" ON "brain_entities" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "brain_entities_user_idx" ON "brain_entities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_entities_user_entity_unique" ON "brain_entities" USING btree ("user_id","entity_name");--> statement-breakpoint
CREATE INDEX "brain_facts_embedding_idx" ON "brain_facts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "brain_facts_user_idx" ON "brain_facts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_facts_user_fact_unique" ON "brain_facts" USING btree ("user_id","fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_agg_lookup_uniq" ON "canonical_aggregations" USING btree ("entity","metric_name");--> statement-breakpoint
CREATE INDEX "correction_queue_status_idx" ON "correction_queue" USING btree ("status","conversation_id");--> statement-breakpoint
CREATE INDEX "data_source_facts_embedding_idx" ON "data_source_facts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "data_source_facts_source_idx" ON "data_source_facts" USING btree ("source");--> statement-breakpoint
CREATE INDEX "data_source_facts_scope_ref_idx" ON "data_source_facts" USING btree ("scope_ref");--> statement-breakpoint
CREATE INDEX "output_req_shape_idx" ON "output_requirements" USING btree ("prompt_shape","entity","is_active");--> statement-breakpoint
CREATE INDEX "proven_queries_embedding_idx" ON "proven_queries" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "proven_queries_tsv_idx" ON "proven_queries" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "proven_queries_protocol_idx" ON "proven_queries" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "tao_lookup_uniq" ON "tool_arg_overrides" USING btree ("user_id","tool_name","arg_name","from_value");