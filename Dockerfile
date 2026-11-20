# Build Stage
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY . .

# Compile static binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server .

# Run Stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /root/
COPY --from=builder /app/server .

# Default port for GCP Cloud Run
ENV PORT=8080

EXPOSE 8080

CMD ["./server"]
