install:
	npm install
build:
	npm run build
up:
	docker compose up -d postgres
migrate:
	npm run db:migrate
server:
	npm run dev:server
dashboard:
	npm run dev:dashboard
test:
	npm test
