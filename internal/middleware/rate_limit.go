package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RateLimiter holds the rate limiting configuration and Redis client
type RateLimiter struct {
	client       *redis.Client
	maxRequests  int
	windowPeriod time.Duration
}

// NewRateLimiter creates a new rate limiter instance
func NewRateLimiter(redisURL string, maxRequests int, windowSeconds int) (*RateLimiter, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid redis URL: %w", err)
	}

	client := redis.NewClient(opt)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	return &RateLimiter{
		client:       client,
		maxRequests:  maxRequests,
		windowPeriod: time.Duration(windowSeconds) * time.Second,
	}, nil
}

// Middleware returns a Gin middleware function for rate limiting
func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get client IP
		ip := c.ClientIP()
		key := fmt.Sprintf("rate_limit:%s", ip)

		ctx := c.Request.Context()

		// Increment request count
		pipe := rl.client.Pipeline()
		incr := pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, rl.windowPeriod)
		_, err := pipe.Exec(ctx)

		if err != nil {
			// If Redis fails, allow the request but log the error
			c.Next()
			return
		}

		// Get current count
		count := incr.Val()

		// Set rate limit headers
		c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", rl.maxRequests))
		c.Header("X-RateLimit-Remaining", fmt.Sprintf("%d", max(0, rl.maxRequests-int(count))))

		// Check if limit exceeded
		if count > int64(rl.maxRequests) {
			// Get TTL for Retry-After header
			ttl, _ := rl.client.TTL(ctx, key).Result()
			c.Header("Retry-After", fmt.Sprintf("%d", int(ttl.Seconds())))

			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error": gin.H{
					"code":    "RATE_LIMIT_EXCEEDED",
					"message": fmt.Sprintf("Rate limit exceeded. Maximum %d requests per %d seconds allowed.", rl.maxRequests, int(rl.windowPeriod.Seconds())),
				},
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// Close closes the Redis connection
func (rl *RateLimiter) Close() error {
	return rl.client.Close()
}

// max returns the maximum of two integers
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
