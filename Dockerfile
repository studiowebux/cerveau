# docker build -t cerveau-server -f Dockerfile .
# docker run -it --rm --name cerveau-server -p 8002:8002 --env-file .env -v ./output:/application/output/ cerveau-server:latest
FROM denoland/deno:alpine-2.4.2

WORKDIR /application

# CORE Component
COPY ./deno.json /application/deno.json
COPY ./deno.lock /application/deno.lock

# APP Specific
COPY . /application/

RUN deno cache /application/mod.ts

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "/application/mod.ts"]
